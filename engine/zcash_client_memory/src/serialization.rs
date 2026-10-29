//! The persisted form of [`MemoryWalletDb`].
//!
//! A self-describing binary format, versioned so that a blob of the old (protobuf) format of
//! ChainSafe's crate, or of a future version, is never misread:
//!
//! ```text
//! magic    16 bytes  "celari-memwallet"
//! version  u32 LE    FORMAT_VERSION
//! network  u8        0 main, 1 test, 2 regtest (checked against the decoding parameters)
//! body               the anchor retention interval (u32 blocks), then every table, in the
//!                    order of `write_body`
//! ```
//!
//! Integers are little-endian; a `Vec` is a u64 count then the items; an `Option` is a 0/1
//! byte then the value. The body is followed by nothing: trailing bytes are an error.
//!
//! The note commitment trees are written in full: cap, every shard, every checkpoint with its
//! `marks_removed` set, and the retained (ZIP 318 anchor) checkpoints. Nothing is
//! recomputed on load, and decoding re-checks the tables' unique indices.
//!
//! There is no migration from the old format (Decision 2 in PORT-NOTES.md): an old blob
//! fails with [`Error::UnsupportedFormat`], and the application rebuilds the wallet from the
//! seed or viewing key and rescans from the birthday.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, Write};

use incrementalmerkletree::{Address as TreeAddress, Level, Position};
use shardtree::{
    LocatedTree, ShardTree,
    store::{Checkpoint, ShardStore, TreeState, memory::MemoryShardStore},
};
use time::OffsetDateTime;
use zcash_client_backend::{
    data_api::{
        AccountBirthday, AccountPurpose, AccountSource, Zip32Derivation,
        anchor_retention::AnchorRetentionInterval,
        chain::ChainState,
        locking::LockOwner,
        scanning::{ScanPriority, ScanRange},
        wallet::TargetHeight,
    },
    serialization::shardtree::{read_shard, write_shard},
    wallet::{Note, NoteId},
};
use zcash_keys::{address::Address, keys::UnifiedFullViewingKey};
use zcash_primitives::{
    block::BlockHash,
    merkle_tree::{HashSer, read_frontier_v1, write_frontier_v1},
    transaction::TxId,
};
use zcash_protocol::{
    PoolType, ShieldedPool,
    consensus::{self, BlockHeight, BranchId, NetworkType},
    memo::MemoBytes,
    value::Zatoshis,
    zip318::Zip318Classification,
};
use zip32::{DiversifierIndex, Scope, fingerprint::SeedFingerprint};

use ::transparent::{
    address::TransparentAddress,
    bundle::{OutPoint, TxOut},
    keys::TransparentKeyScope,
};

#[cfg(feature = "transparent-inputs")]
use ::transparent::keys::NonHardenedChildIndex;

use crate::{
    Account, AccountId, MemoryWalletBlock, MemoryWalletDb, Nullifier, ReceivedNote,
    ReceivedNoteTable, ReceivedTransparentOutput, SentNoteTable, SentOutput, SentOutputId,
    TransactionEntry, TransactionTable, TransparentOutputs,
    error::Error,
    types::{
        Accounts,
        address::{AddressRecord, AddressTable, KeyScope},
        data_requests::{TxQueryType, TxRetrievalQueue},
        locks::{OutputLock, OutputLocks},
        memory_wallet::{PoolTree, SubtreeInfo},
        nullifier::SpendMaps,
        scanning::ScanQueue,
    },
};

#[cfg(feature = "transparent-inputs")]
use crate::types::data_requests::TransparentSpendSearchQueue;

const MAGIC: &[u8; 16] = b"celari-memwallet";
/// The current format version. Bump it on any change to the layout.
pub const FORMAT_VERSION: u32 = 1;

fn corrupt(e: impl std::fmt::Display) -> Error {
    Error::CorruptedData(format!("wallet data: {e}"))
}

// ---------------------------------------------------------------------------------------
// Primitive writers and readers.
// ---------------------------------------------------------------------------------------

struct Enc<'a, W: Write>(&'a mut W);

impl<W: Write> Enc<'_, W> {
    fn raw(&mut self, b: &[u8]) -> io::Result<()> {
        self.0.write_all(b)
    }
    fn u8(&mut self, v: u8) -> io::Result<()> {
        self.raw(&[v])
    }
    fn bool(&mut self, v: bool) -> io::Result<()> {
        self.u8(u8::from(v))
    }
    fn u16(&mut self, v: u16) -> io::Result<()> {
        self.raw(&v.to_le_bytes())
    }
    fn u32(&mut self, v: u32) -> io::Result<()> {
        self.raw(&v.to_le_bytes())
    }
    fn u64(&mut self, v: u64) -> io::Result<()> {
        self.raw(&v.to_le_bytes())
    }
    fn i128(&mut self, v: i128) -> io::Result<()> {
        self.raw(&v.to_le_bytes())
    }
    fn len(&mut self, n: usize) -> io::Result<()> {
        self.u64(n as u64)
    }
    fn bytes(&mut self, b: &[u8]) -> io::Result<()> {
        self.len(b.len())?;
        self.raw(b)
    }
    fn str(&mut self, s: &str) -> io::Result<()> {
        self.bytes(s.as_bytes())
    }
    fn height(&mut self, h: BlockHeight) -> io::Result<()> {
        self.u32(u32::from(h))
    }
    fn opt<T>(
        &mut self,
        v: Option<T>,
        f: impl FnOnce(&mut Self, T) -> io::Result<()>,
    ) -> io::Result<()> {
        match v {
            None => self.u8(0),
            Some(t) => {
                self.u8(1)?;
                f(self, t)
            }
        }
    }
    fn txid(&mut self, t: &TxId) -> io::Result<()> {
        self.raw(t.as_ref())
    }
    fn memo(&mut self, m: &MemoBytes) -> io::Result<()> {
        self.raw(m.as_array())
    }
}

struct Dec<'a>(&'a [u8]);

impl Dec<'_> {
    fn raw<const N: usize>(&mut self) -> Result<[u8; N], Error> {
        if self.0.len() < N {
            return Err(corrupt("unexpected end of data"));
        }
        let (head, tail) = self.0.split_at(N);
        self.0 = tail;
        Ok(head.try_into().expect("length checked"))
    }
    fn u8(&mut self) -> Result<u8, Error> {
        Ok(self.raw::<1>()?[0])
    }
    fn bool(&mut self) -> Result<bool, Error> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            b => Err(corrupt(format!("invalid boolean {b}"))),
        }
    }
    fn u16(&mut self) -> Result<u16, Error> {
        Ok(u16::from_le_bytes(self.raw()?))
    }
    fn u32(&mut self) -> Result<u32, Error> {
        Ok(u32::from_le_bytes(self.raw()?))
    }
    fn u64(&mut self) -> Result<u64, Error> {
        Ok(u64::from_le_bytes(self.raw()?))
    }
    fn i128(&mut self) -> Result<i128, Error> {
        Ok(i128::from_le_bytes(self.raw()?))
    }
    fn len(&mut self) -> Result<usize, Error> {
        let n = self.u64()?;
        // A count can never exceed the remaining bytes (every item takes at least one).
        if n > self.0.len() as u64 {
            return Err(corrupt("count exceeds the remaining data"));
        }
        Ok(n as usize)
    }
    fn bytes(&mut self) -> Result<Vec<u8>, Error> {
        let n = self.len()?;
        let (head, tail) = self.0.split_at(n);
        self.0 = tail;
        Ok(head.to_vec())
    }
    fn str(&mut self) -> Result<String, Error> {
        String::from_utf8(self.bytes()?).map_err(corrupt)
    }
    fn height(&mut self) -> Result<BlockHeight, Error> {
        Ok(BlockHeight::from_u32(self.u32()?))
    }
    fn opt<T>(&mut self, f: impl FnOnce(&mut Self) -> Result<T, Error>) -> Result<Option<T>, Error> {
        match self.u8()? {
            0 => Ok(None),
            1 => f(self).map(Some),
            b => Err(corrupt(format!("invalid option tag {b}"))),
        }
    }
    fn vec<T>(&mut self, mut f: impl FnMut(&mut Self) -> Result<T, Error>) -> Result<Vec<T>, Error> {
        let n = self.len()?;
        (0..n).map(|_| f(self)).collect()
    }
    fn txid(&mut self) -> Result<TxId, Error> {
        Ok(TxId::from_bytes(self.raw()?))
    }
    fn memo(&mut self) -> Result<MemoBytes, Error> {
        MemoBytes::from_bytes(&self.raw::<512>()?).map_err(corrupt)
    }
    /// Runs a reader that takes `impl Read` over the remaining bytes.
    fn with_reader<T>(&mut self, f: impl FnOnce(&mut &[u8]) -> io::Result<T>) -> Result<T, Error> {
        let mut r: &[u8] = self.0;
        let t = f(&mut r).map_err(corrupt)?;
        self.0 = r;
        Ok(t)
    }
}

fn vec_w<W: Write, T>(
    e: &mut Enc<'_, W>,
    items: impl ExactSizeIterator<Item = T>,
    mut f: impl FnMut(&mut Enc<'_, W>, T) -> io::Result<()>,
) -> io::Result<()> {
    e.len(items.len())?;
    for t in items {
        f(e, t)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------
// Codes of small enums. These are part of the format and never change meaning.
// ---------------------------------------------------------------------------------------

fn pool_code(p: ShieldedPool) -> u8 {
    match p {
        ShieldedPool::Sapling => 0,
        ShieldedPool::Orchard => 1,
        ShieldedPool::Ironwood => 2,
    }
}
fn pool_from(c: u8) -> Result<ShieldedPool, Error> {
    match c {
        0 => Ok(ShieldedPool::Sapling),
        1 => Ok(ShieldedPool::Orchard),
        2 => Ok(ShieldedPool::Ironwood),
        c => Err(corrupt(format!("unknown pool code {c}"))),
    }
}
fn pool_type_code(p: PoolType) -> u8 {
    match p {
        PoolType::Transparent => 3,
        PoolType::Shielded(s) => pool_code(s),
    }
}
fn pool_type_from(c: u8) -> Result<PoolType, Error> {
    match c {
        3 => Ok(PoolType::Transparent),
        c => pool_from(c).map(PoolType::Shielded),
    }
}
fn priority_code(p: ScanPriority) -> u8 {
    match p {
        ScanPriority::Ignored => 0,
        ScanPriority::Scanned => 1,
        ScanPriority::Historic => 2,
        ScanPriority::OpenAdjacent => 3,
        ScanPriority::FoundNote => 4,
        ScanPriority::ChainTip => 5,
        ScanPriority::Verify => 6,
    }
}
fn priority_from(c: u8) -> Result<ScanPriority, Error> {
    Ok(match c {
        0 => ScanPriority::Ignored,
        1 => ScanPriority::Scanned,
        2 => ScanPriority::Historic,
        3 => ScanPriority::OpenAdjacent,
        4 => ScanPriority::FoundNote,
        5 => ScanPriority::ChainTip,
        6 => ScanPriority::Verify,
        c => return Err(corrupt(format!("unknown scan priority {c}"))),
    })
}
fn key_scope_code(s: KeyScope) -> u8 {
    match s {
        KeyScope::External => 0,
        KeyScope::Internal => 1,
        KeyScope::Ephemeral => 2,
        KeyScope::Foreign => 3,
    }
}
fn key_scope_from(c: u8) -> Result<KeyScope, Error> {
    Ok(match c {
        0 => KeyScope::External,
        1 => KeyScope::Internal,
        2 => KeyScope::Ephemeral,
        3 => KeyScope::Foreign,
        c => return Err(corrupt(format!("unknown key scope {c}"))),
    })
}
fn zip32_scope_code(s: Scope) -> u8 {
    match s {
        Scope::External => 0,
        Scope::Internal => 1,
    }
}
fn zip32_scope_from(c: u8) -> Result<Scope, Error> {
    match c {
        0 => Ok(Scope::External),
        1 => Ok(Scope::Internal),
        c => Err(corrupt(format!("unknown ZIP 32 scope {c}"))),
    }
}
fn network_code(n: NetworkType) -> u8 {
    match n {
        NetworkType::Main => 0,
        NetworkType::Test => 1,
        NetworkType::Regtest => 2,
    }
}
fn query_type_code(q: TxQueryType) -> u8 {
    match q {
        TxQueryType::Enhancement => 0,
        TxQueryType::Status => 1,
    }
}
fn query_type_from(c: u8) -> Result<TxQueryType, Error> {
    match c {
        0 => Ok(TxQueryType::Enhancement),
        1 => Ok(TxQueryType::Status),
        c => Err(corrupt(format!("unknown query type {c}"))),
    }
}
fn transparent_scope_code(s: TransparentKeyScope) -> io::Result<u32> {
    // The ZIP 32 change-level index (0 external, 1 internal, 2 ephemeral).
    if s == TransparentKeyScope::EXTERNAL {
        Ok(0)
    } else if s == TransparentKeyScope::INTERNAL {
        Ok(1)
    } else if s == TransparentKeyScope::EPHEMERAL {
        Ok(2)
    } else {
        Err(io::Error::other("unsupported transparent key scope"))
    }
}
fn transparent_scope_from(c: u32) -> Result<TransparentKeyScope, Error> {
    TransparentKeyScope::custom(c).ok_or_else(|| corrupt(format!("invalid transparent key scope {c}")))
}

fn taddr_w<W: Write>(e: &mut Enc<'_, W>, t: &TransparentAddress) -> io::Result<()> {
    match t {
        TransparentAddress::PublicKeyHash(h) => {
            e.u8(0)?;
            e.raw(h)
        }
        TransparentAddress::ScriptHash(h) => {
            e.u8(1)?;
            e.raw(h)
        }
    }
}
fn taddr_r(d: &mut Dec<'_>) -> Result<TransparentAddress, Error> {
    match d.u8()? {
        0 => Ok(TransparentAddress::PublicKeyHash(d.raw()?)),
        1 => Ok(TransparentAddress::ScriptHash(d.raw()?)),
        c => Err(corrupt(format!("unknown transparent address kind {c}"))),
    }
}
fn outpoint_w<W: Write>(e: &mut Enc<'_, W>, op: &OutPoint) -> io::Result<()> {
    op.write(&mut *e.0)
}
fn outpoint_r(d: &mut Dec<'_>) -> Result<OutPoint, Error> {
    d.with_reader(|r| OutPoint::read(r))
}

// ---------------------------------------------------------------------------------------
// Composite values.
// ---------------------------------------------------------------------------------------

fn nullifier_w<W: Write>(e: &mut Enc<'_, W>, nf: &Nullifier) -> io::Result<()> {
    match nf {
        Nullifier::Sapling(nf) => {
            e.u8(0)?;
            e.raw(&nf.0)
        }
        #[cfg(feature = "orchard")]
        Nullifier::Orchard(nf) => {
            e.u8(1)?;
            e.raw(&nf.to_bytes())
        }
        #[cfg(feature = "orchard")]
        Nullifier::Ironwood(nf) => {
            e.u8(2)?;
            e.raw(&nf.to_bytes())
        }
    }
}
fn nullifier_r(d: &mut Dec<'_>) -> Result<Nullifier, Error> {
    let pool = pool_from(d.u8()?)?;
    let bytes: [u8; 32] = d.raw()?;
    match pool {
        ShieldedPool::Sapling => Ok(Nullifier::Sapling(sapling::Nullifier(bytes))),
        #[cfg(feature = "orchard")]
        ShieldedPool::Orchard | ShieldedPool::Ironwood => {
            let nf = Option::from(orchard::note::Nullifier::from_bytes(&bytes))
                .ok_or_else(|| corrupt("invalid Orchard-protocol nullifier"))?;
            Ok(if pool == ShieldedPool::Orchard {
                Nullifier::Orchard(nf)
            } else {
                Nullifier::Ironwood(nf)
            })
        }
        #[cfg(not(feature = "orchard"))]
        _ => Err(Error::OrchardNotEnabled),
    }
}

fn note_id_w<W: Write>(e: &mut Enc<'_, W>, id: &NoteId) -> io::Result<()> {
    e.txid(id.txid())?;
    e.u8(pool_code(id.protocol()))?;
    e.u16(id.output_index())
}
fn note_id_r(d: &mut Dec<'_>) -> Result<NoteId, Error> {
    let txid = d.txid()?;
    let pool = pool_from(d.u8()?)?;
    Ok(NoteId::new(txid, pool, d.u16()?))
}

fn note_w<W: Write>(e: &mut Enc<'_, W>, note: &Note) -> io::Result<()> {
    match note {
        Note::Sapling(n) => {
            e.u8(0)?;
            e.raw(&n.recipient().to_bytes())?;
            e.u64(n.value().inner())?;
            match n.rseed() {
                sapling::Rseed::BeforeZip212(rcm) => {
                    e.u8(0)?;
                    e.raw(&group::ff::PrimeField::to_repr(rcm))
                }
                sapling::Rseed::AfterZip212(rseed) => {
                    e.u8(1)?;
                    e.raw(rseed)
                }
            }
        }
        #[cfg(feature = "orchard")]
        Note::Orchard { note, pool } => {
            e.u8(match pool {
                orchard::ValuePool::Orchard => 1,
                orchard::ValuePool::Ironwood => 2,
            })?;
            e.raw(&note.recipient().to_raw_address_bytes())?;
            e.u64(note.value().inner())?;
            e.raw(&note.rho().to_bytes())?;
            e.raw(note.rseed().as_bytes())?;
            e.u8(match note.version() {
                orchard::note::NoteVersion::V2 => 2,
                orchard::note::NoteVersion::V3 => 3,
            })
        }
    }
}
fn note_r(d: &mut Dec<'_>) -> Result<Note, Error> {
    match d.u8()? {
        0 => {
            let recipient = sapling::PaymentAddress::from_bytes(&d.raw()?)
                .ok_or_else(|| corrupt("invalid Sapling address"))?;
            let value = sapling::value::NoteValue::from_raw(d.u64()?);
            let rseed = match d.u8()? {
                0 => sapling::Rseed::BeforeZip212(
                    Option::from(<jubjub::Fr as group::ff::PrimeField>::from_repr(d.raw()?))
                        .ok_or_else(|| corrupt("invalid Sapling rcm"))?,
                ),
                1 => sapling::Rseed::AfterZip212(d.raw()?),
                c => return Err(corrupt(format!("unknown Sapling rseed kind {c}"))),
            };
            Ok(Note::Sapling(sapling::Note::from_parts(recipient, value, rseed)))
        }
        #[cfg(feature = "orchard")]
        c @ (1 | 2) => {
            let pool = if c == 1 {
                orchard::ValuePool::Orchard
            } else {
                orchard::ValuePool::Ironwood
            };
            let recipient = Option::from(orchard::Address::from_raw_address_bytes(&d.raw()?))
                .ok_or_else(|| corrupt("invalid Orchard address"))?;
            let value = orchard::value::NoteValue::from_raw(d.u64()?);
            let rho = Option::from(orchard::note::Rho::from_bytes(&d.raw()?))
                .ok_or_else(|| corrupt("invalid rho"))?;
            let rseed = Option::from(orchard::note::RandomSeed::from_bytes(d.raw()?, &rho))
                .ok_or_else(|| corrupt("invalid Orchard rseed"))?;
            let version = match d.u8()? {
                2 => orchard::note::NoteVersion::V2,
                3 => orchard::note::NoteVersion::V3,
                v => return Err(corrupt(format!("unknown Orchard note version {v}"))),
            };
            let note = Option::from(orchard::Note::from_parts(recipient, value, rho, rseed, version))
                .ok_or_else(|| corrupt("invalid Orchard-protocol note"))?;
            Ok(Note::Orchard { note, pool })
        }
        c => Err(corrupt(format!("unknown note kind {c}"))),
    }
}

fn chain_state_w<W: Write>(e: &mut Enc<'_, W>, cs: &ChainState) -> io::Result<()> {
    e.height(cs.block_height())?;
    e.raw(&cs.block_hash().0)?;
    write_frontier_v1(&mut *e.0, cs.final_sapling_tree())?;
    #[cfg(feature = "orchard")]
    {
        write_frontier_v1(&mut *e.0, cs.final_orchard_tree())?;
        write_frontier_v1(&mut *e.0, cs.final_ironwood_tree())?;
    }
    Ok(())
}
fn chain_state_r(d: &mut Dec<'_>) -> Result<ChainState, Error> {
    let height = d.height()?;
    let hash = BlockHash(d.raw()?);
    let sapling = d.with_reader(|r| read_frontier_v1(r))?;
    #[cfg(feature = "orchard")]
    let orchard = d.with_reader(|r| read_frontier_v1(r))?;
    #[cfg(feature = "orchard")]
    let ironwood = d.with_reader(|r| read_frontier_v1(r))?;
    Ok(ChainState::new(
        height,
        hash,
        sapling,
        #[cfg(feature = "orchard")]
        orchard,
        #[cfg(feature = "orchard")]
        ironwood,
    ))
}

fn derivation_w<W: Write>(e: &mut Enc<'_, W>, d: &Zip32Derivation) -> io::Result<()> {
    e.raw(&d.seed_fingerprint().to_bytes())?;
    e.u32(u32::from(d.account_index()))
}
fn derivation_r(d: &mut Dec<'_>) -> Result<Zip32Derivation, Error> {
    let fp = SeedFingerprint::from_bytes(d.raw()?);
    let index = zip32::AccountId::try_from(d.u32()?).map_err(corrupt)?;
    Ok(Zip32Derivation::new(fp, index))
}

// ---------------------------------------------------------------------------------------
// Note commitment trees.
// ---------------------------------------------------------------------------------------

fn tree_w<W: Write, H: HashSer + incrementalmerkletree::Hashable + Clone + PartialEq, const DEPTH: u8, const SH: u8>(
    e: &mut Enc<'_, W>,
    pool_tree: &PoolTree<ShardTree<MemoryShardStore<H, BlockHeight>, DEPTH, SH>, H>,
) -> io::Result<()> {
    let infallible = |e: std::convert::Infallible| -> io::Error { match e {} };
    // Server-reported subtree roots.
    vec_w(e, pool_tree.subtrees.iter(), |e, (index, info)| {
        e.u64(*index)?;
        info.root.write(&mut *e.0)?;
        e.height(info.end_height)
    })?;
    let store = pool_tree.tree.store();
    // Cap.
    write_shard(&mut *e.0, &store.get_cap().map_err(infallible)?)?;
    // Shards.
    let roots = store.get_shard_roots().map_err(infallible)?;
    let mut shards = vec![];
    for addr in roots {
        if let Some(shard) = store.get_shard(addr).map_err(infallible)? {
            shards.push(shard);
        }
    }
    vec_w(e, shards.iter(), |e, shard| {
        e.u8(u8::from(shard.root_addr().level()))?;
        e.u64(shard.root_addr().index())?;
        write_shard(&mut *e.0, shard.root())
    })?;
    // Checkpoints, with the positions whose marks they remove.
    let mut checkpoints = vec![];
    store
        .for_each_checkpoint(usize::MAX, |id, cp| {
            checkpoints.push((*id, cp.clone()));
            Ok(())
        })
        .map_err(infallible)?;
    vec_w(e, checkpoints.iter(), |e, (id, cp)| {
        e.height(*id)?;
        match cp.tree_state() {
            TreeState::Empty => e.u8(0)?,
            TreeState::AtPosition(p) => {
                e.u8(1)?;
                e.u64(u64::from(p))?;
            }
        }
        vec_w(e, cp.marks_removed().iter(), |e, p| e.u64(u64::from(*p)))
    })?;
    // Retained (anchor) checkpoints.
    let retained = store.retained_checkpoints().map_err(infallible)?;
    vec_w(e, retained.iter(), |e, h| e.height(*h))
}

fn tree_r<H: HashSer + incrementalmerkletree::Hashable + Clone + PartialEq, const DEPTH: u8, const SH: u8>(
    d: &mut Dec<'_>,
    max_checkpoints: usize,
) -> Result<PoolTree<ShardTree<MemoryShardStore<H, BlockHeight>, DEPTH, SH>, H>, Error> {
    let infallible = |e: std::convert::Infallible| -> Error { match e {} };
    let subtrees = d.vec(|d| {
        let index = d.u64()?;
        let root = d.with_reader(|r| H::read(r))?;
        let end_height = d.height()?;
        Ok((index, SubtreeInfo { root, end_height }))
    })?;
    let mut store = MemoryShardStore::<H, BlockHeight>::empty();
    let cap = d.with_reader(|r| read_shard(r))?;
    store.put_cap(cap).map_err(infallible)?;
    let shards = d.vec(|d| {
        let level = Level::from(d.u8()?);
        let index = d.u64()?;
        let tree = d.with_reader(|r| read_shard(r))?;
        LocatedTree::from_parts(TreeAddress::from_parts(level, index), tree)
            .map_err(|_| corrupt("invalid shard"))
    })?;
    for shard in shards {
        if u8::from(shard.root_addr().level()) != SH {
            return Err(corrupt("shard at the wrong level"));
        }
        store.put_shard(shard).map_err(infallible)?;
    }
    let checkpoints = d.vec(|d| {
        let id = d.height()?;
        let state = match d.u8()? {
            0 => TreeState::Empty,
            1 => TreeState::AtPosition(Position::from(d.u64()?)),
            c => return Err(corrupt(format!("unknown checkpoint state {c}"))),
        };
        let marks: BTreeSet<Position> = d.vec(|d| d.u64().map(Position::from))?.into_iter().collect();
        Ok((id, Checkpoint::from_parts(state, marks)))
    })?;
    for (id, cp) in checkpoints {
        store.add_checkpoint(id, cp).map_err(infallible)?;
    }
    let retained = d.vec(|d| d.height())?;
    for id in retained {
        store.add_retained_checkpoint(id).map_err(infallible)?;
    }
    let mut pool_tree = PoolTree::new(ShardTree::new(store, max_checkpoints));
    pool_tree.subtrees = subtrees.into_iter().collect::<BTreeMap<_, _>>();
    Ok(pool_tree)
}

// ---------------------------------------------------------------------------------------
// The wallet.
// ---------------------------------------------------------------------------------------

impl<P: consensus::Parameters> MemoryWalletDb<P> {
    /// Serializes the wallet (see the module documentation for the format).
    pub fn encode<W: Write>(&self, w: &mut W) -> Result<(), Error> {
        let mut e = Enc(w);
        e.raw(MAGIC)?;
        e.u32(FORMAT_VERSION)?;
        e.u8(network_code(self.params.network_type()))?;
        self.write_body(&mut e)?;
        Ok(())
    }

    /// Deserializes a wallet written by [`Self::encode`] with the same network parameters.
    ///
    /// A blob in another format (including ChainSafe's protobuf format) or another format
    /// version is rejected with [`Error::UnsupportedFormat`]; the caller must then rebuild the
    /// wallet from its keys and rescan.
    pub fn decode_new(bytes: &[u8], params: P, max_checkpoints: usize) -> Result<Self, Error> {
        let mut d = Dec(bytes);
        let magic: [u8; 16] = d.raw().map_err(|_| Error::UnsupportedFormat(None))?;
        if &magic != MAGIC {
            return Err(Error::UnsupportedFormat(None));
        }
        let version = d.u32()?;
        if version != FORMAT_VERSION {
            return Err(Error::UnsupportedFormat(Some(version)));
        }
        let network = d.u8()?;
        if network != network_code(params.network_type()) {
            return Err(Error::CorruptedData(
                "the stored wallet belongs to a different network".into(),
            ));
        }
        let db = Self::read_body(&mut d, params, max_checkpoints)?;
        if !d.0.is_empty() {
            return Err(corrupt("trailing bytes after the wallet data"));
        }
        Ok(db)
    }

    fn write_body<W: Write>(&self, e: &mut Enc<'_, W>) -> io::Result<()> {
        let params = &self.params;

        // the anchor retention interval, in blocks
        e.u32(self.anchor_retention_interval.block_count().get())?;

        // accounts
        e.u32(self.accounts.nonce)?;
        vec_w(e, self.accounts.accounts.values(), |e, a| {
            e.u32(u32::from(a.id))?;
            e.opt(a.name.as_deref(), |e, n| e.str(n))?;
            match &a.source {
                AccountSource::Derived {
                    derivation,
                    key_source,
                } => {
                    e.u8(0)?;
                    derivation_w(e, derivation)?;
                    e.opt(key_source.as_deref(), |e, s| e.str(s))?;
                }
                AccountSource::Imported {
                    purpose,
                    key_source,
                } => {
                    e.u8(1)?;
                    match purpose {
                        AccountPurpose::Spending { derivation } => {
                            e.u8(0)?;
                            e.opt(derivation.as_ref(), derivation_w)?;
                        }
                        AccountPurpose::ViewOnly => e.u8(1)?,
                    }
                    e.opt(key_source.as_deref(), |e, s| e.str(s))?;
                }
            }
            e.str(&a.ufvk.encode(params).map_err(io::Error::other)?)?;
            chain_state_w(e, a.birthday.prior_chain_state())?;
            e.opt(a.birthday.recover_until(), |e, h| e.height(h))
        })?;

        // addresses
        e.u64(self.addresses.next_id())?;
        let rows: Vec<_> = self.addresses.iter().collect();
        vec_w(e, rows.into_iter(), |e, (id, r)| {
            e.u64(id)?;
            e.u32(u32::from(r.account_id))?;
            e.u8(key_scope_code(r.key_scope))?;
            e.opt(r.diversifier_index, |e, di| e.raw(di.as_bytes()))?;
            e.str(&r.address.encode(params))?;
            #[cfg(feature = "transparent-inputs")]
            e.opt(r.transparent_child_index, |e, i| e.u32(i.index()))?;
            #[cfg(not(feature = "transparent-inputs"))]
            e.u8(0)?;
            e.opt(r.transparent_receiver.as_ref(), taddr_w)?;
            e.opt(r.exposed_at_height, |e, h| e.height(h))?;
            e.opt(r.next_check_time, |e, t| e.u64(t))
        })?;

        // blocks
        vec_w(e, self.blocks.values(), |e, b| {
            e.height(b.height)?;
            e.raw(&b.hash.0)?;
            e.u32(b.block_time)?;
            e.u32(b.sapling_commitment_tree_size)?;
            e.u32(b.sapling_output_count)?;
            #[cfg(feature = "orchard")]
            {
                e.u32(b.orchard_commitment_tree_size)?;
                e.u32(b.orchard_action_count)?;
                e.u32(b.ironwood_commitment_tree_size)?;
                e.u32(b.ironwood_action_count)?;
            }
            #[cfg(not(feature = "orchard"))]
            {
                e.u32(0)?;
                e.u32(0)?;
                e.u32(0)?;
                e.u32(0)?;
            }
            Ok(())
        })?;

        // transactions
        vec_w(e, self.tx_table.0.values(), |e, t| {
            e.txid(&t.txid)?;
            e.opt(t.created, |e, c| e.i128(c.unix_timestamp_nanos()))?;
            e.opt(t.block, |e, h| e.height(h))?;
            e.opt(t.mined_height, |e, h| e.height(h))?;
            e.opt(t.tx_index, |e, i| e.u16(i))?;
            e.opt(t.expiry_height, |e, h| e.height(h))?;
            e.opt(t.raw.as_ref(), |e, (bytes, branch)| {
                e.bytes(bytes)?;
                e.u32(u32::from(*branch))
            })?;
            e.opt(t.fee, |e, f| e.u64(u64::from(f)))?;
            e.opt(t.target_height, |e, h| e.height(BlockHeight::from(h)))?;
            e.height(t.min_observed_height)?;
            e.opt(t.confirmed_unmined_at_height, |e, h| e.height(h))?;
            e.bool(t.trusted)?;
            e.u8(u8::try_from(t.zip318.to_code()).unwrap_or(0))
        })?;

        // received notes and their spends
        vec_w(e, self.received_notes.iter().collect::<Vec<_>>().into_iter(), |e, rn| {
            note_id_w(e, &rn.note_id)?;
            e.u32(u32::from(rn.account_id))?;
            note_w(e, &rn.note)?;
            e.opt(rn.nf.as_ref(), nullifier_w)?;
            e.bool(rn.is_change)?;
            e.opt(rn.memo.as_ref(), |e, m| e.memo(m))?;
            e.opt(rn.commitment_tree_position, |e, p| e.u64(u64::from(p)))?;
            e.opt(rn.recipient_key_scope, |e, s| e.u8(zip32_scope_code(s)))?;
            e.opt(rn.address_id, |e, a| e.u64(a))
        })?;
        let spends: Vec<_> = self.received_notes.all_spends().collect();
        vec_w(e, spends.into_iter(), |e, (id, txs)| {
            note_id_w(e, id)?;
            vec_w(e, txs.iter(), |e, t| e.txid(t))
        })?;

        // sent outputs
        vec_w(e, self.sent_notes.0.iter(), |e, (id, o)| {
            e.txid(&id.txid)?;
            e.u8(pool_type_code(id.pool))?;
            e.u32(id.output_index)?;
            e.u32(u32::from(o.from_account_id))?;
            e.opt(o.to_address.as_deref(), |e, s| e.str(s))?;
            e.opt(o.to_account_id, |e, a| e.u32(u32::from(a)))?;
            e.u64(u64::from(o.value))?;
            e.opt(o.memo.as_ref(), |e, m| e.memo(m))
        })?;

        // spend maps
        let locators: Vec<_> = self.spend_maps.tx_locators().collect();
        vec_w(e, locators.into_iter(), |e, ((h, i), txid)| {
            e.height(*h)?;
            e.u16(*i)?;
            e.txid(txid)
        })?;
        let nfs: Vec<_> = self.spend_maps.nullifiers().collect();
        vec_w(e, nfs.into_iter(), |e, (nf, (h, i))| {
            nullifier_w(e, nf)?;
            e.height(*h)?;
            e.u16(*i)
        })?;
        #[cfg(feature = "transparent-inputs")]
        {
            let ts: Vec<_> = self.spend_maps.transparent_spends().collect();
            vec_w(e, ts.into_iter(), |e, (op, (h, i))| {
                outpoint_w(e, op)?;
                e.height(*h)?;
                e.u16(*i)
            })?;
        }
        #[cfg(not(feature = "transparent-inputs"))]
        e.len(0)?;

        // transparent outputs
        vec_w(e, self.transparent.outputs.values(), |e, o| {
            outpoint_w(e, &o.outpoint)?;
            e.u32(u32::from(o.account_id))?;
            taddr_w(e, &o.address)?;
            e.u64(o.address_id)?;
            e.opt(o.key_scope, |e, s| e.u32(transparent_scope_code(s)?))?;
            o.txout.write(&mut *e.0)?;
            e.opt(o.max_observed_unspent_height, |e, h| e.height(h))
        })?;
        vec_w(e, self.transparent.spends.iter(), |e, (op, txs)| {
            outpoint_w(e, op)?;
            vec_w(e, txs.iter(), |e, t| e.txid(t))
        })?;
        vec_w(e, self.transparent.spend_map.iter(), |e, (txid, op)| {
            e.txid(txid)?;
            outpoint_w(e, op)
        })?;

        // data request queues
        vec_w(e, self.tx_retrieval_queue.0.iter(), |e, ((txid, q), dep)| {
            e.txid(txid)?;
            e.u8(query_type_code(*q))?;
            e.opt(dep.as_ref(), |e, t| e.txid(t))
        })?;
        #[cfg(feature = "transparent-inputs")]
        vec_w(e, self.transparent_spend_search_queue.0.iter(), |e, ((txid, n), addr)| {
            e.txid(txid)?;
            e.u32(*n)?;
            taddr_w(e, addr)
        })?;
        #[cfg(not(feature = "transparent-inputs"))]
        e.len(0)?;

        // scan queue
        vec_w(e, self.scan_queue.0.iter(), |e, (start, end, p)| {
            e.height(*start)?;
            e.height(*end)?;
            e.u8(priority_code(*p))
        })?;

        // output locks
        vec_w(e, self.output_locks.0.iter(), |e, ((txid, pool, index), lock)| {
            e.txid(txid)?;
            e.u8(pool_type_code(*pool))?;
            e.u32(*index)?;
            e.height(lock.expiry_height)?;
            e.raw(lock.owner.as_bytes())
        })?;

        // note commitment trees
        tree_w(e, &self.sapling)?;
        #[cfg(feature = "orchard")]
        {
            tree_w(e, &self.orchard)?;
            tree_w(e, &self.ironwood)?;
        }
        // (The transparent gap limits are not stored: this backend always uses the
        // defaults of `GapLimits`.)
        Ok(())
    }

    fn read_body(d: &mut Dec<'_>, params: P, max_checkpoints: usize) -> Result<Self, Error> {
        let mut db = Self::new(params, max_checkpoints);
        let params = db.params.clone();

        // the anchor retention interval, in blocks
        db.anchor_retention_interval = AnchorRetentionInterval::custom(
            std::num::NonZeroU32::new(d.u32()?)
                .ok_or_else(|| corrupt("zero anchor retention interval"))?,
        );

        // accounts
        let nonce = d.u32()?;
        let accounts = d.vec(|d| {
            let id = AccountId::from(d.u32()?);
            let name = d.opt(|d| d.str())?;
            let source = match d.u8()? {
                0 => AccountSource::Derived {
                    derivation: derivation_r(d)?,
                    key_source: d.opt(|d| d.str())?,
                },
                1 => {
                    let purpose = match d.u8()? {
                        0 => AccountPurpose::Spending {
                            derivation: d.opt(derivation_r)?,
                        },
                        1 => AccountPurpose::ViewOnly,
                        c => return Err(corrupt(format!("unknown account purpose {c}"))),
                    };
                    AccountSource::Imported {
                        purpose,
                        key_source: d.opt(|d| d.str())?,
                    }
                }
                c => return Err(corrupt(format!("unknown account source {c}"))),
            };
            let ufvk = UnifiedFullViewingKey::decode(&params, &d.str()?).map_err(corrupt)?;
            let chain_state = chain_state_r(d)?;
            let recover_until = d.opt(|d| d.height())?;
            Ok(Account {
                id,
                name,
                source,
                ufvk,
                birthday: AccountBirthday::from_parts(chain_state, recover_until),
            })
        })?;
        let mut account_map = BTreeMap::new();
        for a in accounts {
            if u32::from(a.id) > nonce || account_map.insert(a.id, a).is_some() {
                return Err(corrupt("invalid account id"));
            }
        }
        db.accounts = Accounts {
            nonce,
            accounts: account_map,
        };
        let known_account = |db: &Self, id: AccountId| -> Result<AccountId, Error> {
            db.accounts
                .get(id)
                .map(|_| id)
                .ok_or_else(|| corrupt(format!("reference to unknown account {id:?}")))
        };

        // addresses
        let next_id = d.u64()?;
        let rows = d.vec(|d| {
            let id = d.u64()?;
            let account_id = AccountId::from(d.u32()?);
            let key_scope = key_scope_from(d.u8()?)?;
            let diversifier_index = d.opt(|d| Ok(DiversifierIndex::from(d.raw::<11>()?)))?;
            let address = Address::decode(&params, &d.str()?)
                .ok_or_else(|| corrupt("invalid stored address"))?;
            #[cfg(feature = "transparent-inputs")]
            let transparent_child_index = d.opt(|d| {
                NonHardenedChildIndex::from_index(d.u32()?)
                    .ok_or_else(|| corrupt("invalid transparent child index"))
            })?;
            #[cfg(not(feature = "transparent-inputs"))]
            if d.u8()? != 0 {
                return Err(corrupt("transparent data in a build without transparent-inputs"));
            }
            let transparent_receiver = d.opt(taddr_r)?;
            let exposed_at_height = d.opt(|d| d.height())?;
            let next_check_time = d.opt(|d| d.u64())?;
            Ok((
                id,
                AddressRecord {
                    account_id,
                    key_scope,
                    diversifier_index,
                    address,
                    #[cfg(feature = "transparent-inputs")]
                    transparent_child_index,
                    transparent_receiver,
                    exposed_at_height,
                    next_check_time,
                },
            ))
        })?;
        for (_, r) in &rows {
            known_account(&db, r.account_id)?;
        }
        db.addresses = AddressTable::from_parts(next_id, rows)?;

        // blocks
        let blocks = d.vec(|d| {
            let height = d.height()?;
            let hash = BlockHash(d.raw()?);
            let block_time = d.u32()?;
            let sapling_commitment_tree_size = d.u32()?;
            let sapling_output_count = d.u32()?;
            let o = [d.u32()?, d.u32()?, d.u32()?, d.u32()?];
            #[cfg(not(feature = "orchard"))]
            let _ = o;
            Ok(MemoryWalletBlock {
                height,
                hash,
                block_time,
                sapling_commitment_tree_size,
                sapling_output_count,
                #[cfg(feature = "orchard")]
                orchard_commitment_tree_size: o[0],
                #[cfg(feature = "orchard")]
                orchard_action_count: o[1],
                #[cfg(feature = "orchard")]
                ironwood_commitment_tree_size: o[2],
                #[cfg(feature = "orchard")]
                ironwood_action_count: o[3],
            })
        })?;
        db.blocks = blocks.into_iter().map(|b| (b.height, b)).collect();

        // transactions
        let txs = d.vec(|d| {
            let txid = d.txid()?;
            let created = d
                .opt(|d| d.i128())?
                .map(|n| OffsetDateTime::from_unix_timestamp_nanos(n).map_err(corrupt))
                .transpose()?;
            let block = d.opt(|d| d.height())?;
            let mined_height = d.opt(|d| d.height())?;
            let tx_index = d.opt(|d| d.u16())?;
            let expiry_height = d.opt(|d| d.height())?;
            let raw = d.opt(|d| {
                let bytes = d.bytes()?;
                let branch = BranchId::try_from(d.u32()?).map_err(corrupt)?;
                Ok((bytes, branch))
            })?;
            let fee = d
                .opt(|d| d.u64())?
                .map(|f| Zatoshis::from_u64(f).map_err(corrupt))
                .transpose()?;
            let target_height = d.opt(|d| d.height().map(TargetHeight::from))?;
            let min_observed_height = d.height()?;
            let confirmed_unmined_at_height = d.opt(|d| d.height())?;
            let trusted = d.bool()?;
            let zip318 = Zip318Classification::from_code(i64::from(d.u8()?));
            Ok(TransactionEntry {
                txid,
                created,
                block,
                mined_height,
                tx_index,
                expiry_height,
                raw,
                fee,
                target_height,
                min_observed_height,
                confirmed_unmined_at_height,
                trusted,
                zip318,
            })
        })?;
        db.tx_table = TransactionTable(txs.into_iter().map(|t| (t.txid, t)).collect());

        // received notes
        let notes = d.vec(|d| {
            let note_id = note_id_r(d)?;
            let account_id = AccountId::from(d.u32()?);
            let note = note_r(d)?;
            let nf = d.opt(nullifier_r)?;
            let is_change = d.bool()?;
            let memo = d.opt(|d| d.memo())?;
            let commitment_tree_position = d.opt(|d| d.u64().map(Position::from))?;
            let recipient_key_scope = d.opt(|d| zip32_scope_from(d.u8()?))?;
            let address_id = d.opt(|d| d.u64())?;
            Ok(ReceivedNote {
                note_id,
                account_id,
                note,
                nf,
                is_change,
                memo,
                commitment_tree_position,
                recipient_key_scope,
                address_id,
            })
        })?;
        for rn in &notes {
            known_account(&db, rn.account_id)?;
            if !db.tx_table.contains(rn.note_id.txid()) {
                return Err(corrupt("a stored note refers to an unknown transaction"));
            }
        }
        let spends = d.vec(|d| {
            let id = note_id_r(d)?;
            let txs: BTreeSet<TxId> = d.vec(|d| d.txid())?.into_iter().collect();
            Ok((id, txs))
        })?;
        db.received_notes = ReceivedNoteTable::from_parts(notes, spends)?;

        // sent outputs
        let sent = d.vec(|d| {
            let txid = d.txid()?;
            let pool = pool_type_from(d.u8()?)?;
            let output_index = d.u32()?;
            let from_account_id = AccountId::from(d.u32()?);
            let to_address = d.opt(|d| d.str())?;
            let to_account_id = d.opt(|d| d.u32().map(AccountId::from))?;
            let value = Zatoshis::from_u64(d.u64()?).map_err(corrupt)?;
            let memo = d.opt(|d| d.memo())?;
            Ok((
                SentOutputId {
                    txid,
                    pool,
                    output_index,
                },
                SentOutput {
                    from_account_id,
                    to_address,
                    to_account_id,
                    value,
                    memo,
                },
            ))
        })?;
        db.sent_notes = SentNoteTable(sent.into_iter().collect());

        // spend maps
        let locators = d.vec(|d| Ok(((d.height()?, d.u16()?), d.txid()?)))?;
        let nfs = d.vec(|d| Ok((nullifier_r(d)?, (d.height()?, d.u16()?))))?;
        #[cfg(feature = "transparent-inputs")]
        let ts = d.vec(|d| Ok((outpoint_r(d)?, (d.height()?, d.u16()?))))?;
        #[cfg(not(feature = "transparent-inputs"))]
        if d.len()? != 0 {
            return Err(corrupt("transparent data in a build without transparent-inputs"));
        }
        db.spend_maps = SpendMaps::from_parts(
            locators,
            nfs,
            #[cfg(feature = "transparent-inputs")]
            ts,
        )?;

        // transparent outputs
        let outputs = d.vec(|d| {
            let outpoint = outpoint_r(d)?;
            let account_id = AccountId::from(d.u32()?);
            let address = taddr_r(d)?;
            let address_id = d.u64()?;
            let key_scope = d.opt(|d| transparent_scope_from(d.u32()?))?;
            let txout = d.with_reader(|r| TxOut::read(r))?;
            let max_observed_unspent_height = d.opt(|d| d.height())?;
            Ok(ReceivedTransparentOutput {
                outpoint,
                account_id,
                address,
                address_id,
                key_scope,
                txout,
                max_observed_unspent_height,
            })
        })?;
        for o in &outputs {
            known_account(&db, o.account_id)?;
            if db.addresses.get(o.address_id).is_none() {
                return Err(corrupt("a transparent output refers to an unknown address"));
            }
        }
        let t_spends = d.vec(|d| {
            let op = outpoint_r(d)?;
            let txs: BTreeSet<TxId> = d.vec(|d| d.txid())?.into_iter().collect();
            Ok((op, txs))
        })?;
        let spend_map = d.vec(|d| Ok((d.txid()?, outpoint_r(d)?)))?;
        db.transparent = TransparentOutputs {
            outputs: outputs.into_iter().map(|o| (o.outpoint.clone(), o)).collect(),
            spends: t_spends.into_iter().collect(),
            spend_map: spend_map.into_iter().collect(),
        };

        // data request queues
        let queue = d.vec(|d| {
            let txid = d.txid()?;
            let q = query_type_from(d.u8()?)?;
            let dep = d.opt(|d| d.txid())?;
            Ok(((txid, q), dep))
        })?;
        db.tx_retrieval_queue = TxRetrievalQueue(queue.into_iter().collect());
        #[cfg(feature = "transparent-inputs")]
        {
            let q = d.vec(|d| Ok(((d.txid()?, d.u32()?), taddr_r(d)?)))?;
            db.transparent_spend_search_queue = TransparentSpendSearchQueue(q.into_iter().collect());
        }
        #[cfg(not(feature = "transparent-inputs"))]
        if d.len()? != 0 {
            return Err(corrupt("transparent data in a build without transparent-inputs"));
        }

        // scan queue
        let ranges = d.vec(|d| {
            let start = d.height()?;
            let end = d.height()?;
            let p = priority_from(d.u8()?)?;
            if start >= end {
                return Err(corrupt("empty scan range"));
            }
            Ok(ScanRange::from_parts(start..end, p))
        })?;
        db.scan_queue = ScanQueue::from_entries(ranges)?;

        // output locks
        let locks = d.vec(|d| {
            let txid = d.txid()?;
            let pool = pool_type_from(d.u8()?)?;
            let index = d.u32()?;
            let expiry_height = d.height()?;
            let owner = LockOwner::new(d.raw()?);
            Ok(((txid, pool, index), OutputLock { expiry_height, owner }))
        })?;
        db.output_locks = OutputLocks(locks.into_iter().collect());

        // note commitment trees
        db.sapling = tree_r(d, max_checkpoints)?;
        #[cfg(feature = "orchard")]
        {
            db.orchard = tree_r(d, max_checkpoints)?;
            db.ironwood = tree_r(d, max_checkpoints)?;
        }
        Ok(db)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_foreign_blobs() {
        let network = zcash_protocol::consensus::Network::MainNetwork;
        // ChainSafe's protobuf blobs start with a field tag, never with the magic.
        let old = [0x08u8, 0x01, 0x12, 0x00];
        assert!(matches!(
            MemoryWalletDb::decode_new(&old, network, 100),
            Err(Error::UnsupportedFormat(None))
        ));
        let mut future = MAGIC.to_vec();
        future.extend_from_slice(&(FORMAT_VERSION + 1).to_le_bytes());
        assert!(matches!(
            MemoryWalletDb::decode_new(&future, network, 100),
            Err(Error::UnsupportedFormat(Some(_)))
        ));
    }

    #[test]
    fn empty_wallet_round_trips() {
        let network = zcash_protocol::consensus::Network::MainNetwork;
        let db = MemoryWalletDb::new(network, 100);
        let mut bytes = vec![];
        db.encode(&mut bytes).unwrap();
        let back = MemoryWalletDb::decode_new(&bytes, network, 100).unwrap();
        let mut again = vec![];
        back.encode(&mut again).unwrap();
        assert_eq!(bytes, again);
        // A different network is refused.
        assert!(MemoryWalletDb::decode_new(&bytes, zcash_protocol::consensus::Network::TestNetwork, 100).is_err());
        // Truncated data is refused.
        assert!(MemoryWalletDb::decode_new(&bytes[..bytes.len() - 1], network, 100).is_err());
    }
}
