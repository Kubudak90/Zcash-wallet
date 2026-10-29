# Mainnet test vectors, blocks 3,533,400 to 3,533,508

Used by `src/testing/mainnet_blocks.rs` and by webzjs-wallet's native tests
(`webzjs/crates/webzjs-wallet/src/tests/`, which read this directory as
`../../../engine/zcash_client_memory/testdata/`, the same relative path in Celari's layout). Every file is a raw gRPC-web response body
(5-byte frames: flag byte, big-endian u32 length, payload; the last frame is the
`grpc-status` trailer) from the lightwalletd proxy `https://zcash-mainnet.chainsafe.dev`,
`cash.z.wallet.sdk.rpc.CompactTxStreamer`:

| file | method | request |
| --- | --- | --- |
| `blocks-3533400-3533508.grpcweb` | `GetBlockRange` | `BlockRange { start: 3533400, end: 3533508 }` (109 `CompactBlock`s) |
| `treestate-3533399.grpcweb` | `GetTreeState` | `BlockID { height: 3533399 }` |
| `treestate-3533450.grpcweb` | `GetTreeState` | `BlockID { height: 3533450 }` |
| `treestate-3533508.grpcweb` | `GetTreeState` | `BlockID { height: 3533508 }` |
| `treestate-35334{19,39,59,79,99}.grpcweb` | `GetTreeState` | `BlockID { height: … }` (batch starts of a 20-block-batch sync, webzjs-wallet `tests::sync_pass`) |
| `tx-4c0f8c16….grpcweb` | `GetTransaction` | `TxFilter { hash: 4c0f8c16… }` (block 3,533,400, v6, 3 Ironwood actions) |
| `tx-9426056d….grpcweb` | `GetTransaction` | `TxFilter { hash: 9426056d… }` (block 3,533,403, v6, Sapling) |
| `subtree-roots-sapling.grpcweb` | `GetSubtreeRoots` | `{ start_index: 0, shielded_protocol: Sapling, max_entries: 0 }` (1,129 roots) |
| `subtree-roots-orchard.grpcweb` | `GetSubtreeRoots` | `{ start_index: 0, shielded_protocol: Orchard, max_entries: 0 }` (770 roots) |
| `subtree-roots-ironwood.grpcweb` | `GetSubtreeRoots` | `{ start_index: 0, shielded_protocol: Ironwood, max_entries: 0 }` (14 roots) |

The blocks are past NU6.3 (Ironwood, mainnet 3,428,143) and carry 382 Ironwood actions,
29 Orchard actions and 50 Sapling outputs. The block range was captured on 2026-10-28 by
the engine investigation (`scratchpad/ironwood/net/range-tip.bin`); the tree states were
fetched the same day for this test, and the subtree roots (all completed subtrees, at a tip
of about 3,533,810) later that day for `subtree_roots_put_again_change_nothing`.

The data is not trusted by the test: it checks that the block hashes chain onto the tree
states, and that the note commitment tree roots the wallet computes from the blocks equal
the roots of the server's frontiers at 3,533,450 and 3,533,508. A tampered file fails the
test rather than passing it.

The transactions were fetched on 2026-10-28 for webzjs-wallet's enhancement tests
(round 3). `TxFilter.hash` is the txid in internal byte order, as compact blocks carry it;
the server answered "not found" (status 5, "-5: Transaction not found in mempool or best
chain") for the reversed order and for an unknown txid. The tests check that each parses
and that its txid is the one requested.

To regenerate (from a directory holding the investigation's `tools/`):

```sh
python3 -I tools/grpcweb.py blockrange 3533400 3533508 > req.bin
tools/lwd.sh GetBlockRange req.bin blocks-3533400-3533508.grpcweb
python3 -I tools/grpcweb.py blockid 3533399 > req.bin
tools/lwd.sh GetTreeState req.bin treestate-3533399.grpcweb
# GetSubtreeRootsArg { shielded_protocol: 1 (Orchard) }; 0 (Sapling) is the empty message, 2 is Ironwood
printf '\x00\x00\x00\x00\x02\x10\x01' > req.bin
tools/lwd.sh GetSubtreeRoots req.bin subtree-roots-orchard.grpcweb
python3 -I tools/grpcweb.py txfilter 4c0f8c16556719aa01a878e57302740f594eb7b7eacb195cd0f68dda0b30f3a4 > req.bin
tools/lwd.sh GetTransaction req.bin tx-4c0f8c16556719aa01a878e57302740f594eb7b7eacb195cd0f68dda0b30f3a4.grpcweb
```

SHA-256:

```
262f1c66ca34704674638388aef96d42e50c38d016c12aeaa2116479ed540abb  blocks-3533400-3533508.grpcweb
a31cb9b1704caf06a1b8c7079db1f1fa92b972d8d29e8f4475434725afc2900e  treestate-3533399.grpcweb
d1791f385680112adfae5c710c1cbd24cd1b22f8234e1119e9beb995df854abb  treestate-3533450.grpcweb
065b4f3723013027a60d2081ece18b679bfdc1730ad13902269a71fe68c46c96  treestate-3533508.grpcweb
e296d00d93bf0d6068162c78b761ad584cc933545b81646abfa3350b9aa3f1db  subtree-roots-ironwood.grpcweb
2fc93381baf29bfb12a1b84127807815351c3aaa297b32b80ebf3636f7c24fc0  subtree-roots-orchard.grpcweb
e4725785a06ce88caeda85c3348464dc811aad5acafe308065410e1fa269f4fc  subtree-roots-sapling.grpcweb
16c514a916a667f2d2488ceb46d8e0b8369e84bf41440bcff015809a22e1874c  treestate-3533419.grpcweb
a38c1af10ef7ddaf13ee2aed250df8e29ac1ebf0f115fef67e957deeba6f5dc2  treestate-3533439.grpcweb
ee82afec404d9b3099e4507d275efb09754de94c26dde0d4243ad5587add0161  treestate-3533459.grpcweb
bbf0d8aef2559543b120c023f18c28ecafa2bac6ae0497b30ec0a2f4810c55cc  treestate-3533479.grpcweb
cd9e52afcae7849c9b386244eaba581ad230199d6d2f83a6decf7cb00badf1e8  treestate-3533499.grpcweb
1fcc89f9b54324858253832235ef38b67c2a180c6cca321b76cc50b3f70f35e4  tx-4c0f8c16556719aa01a878e57302740f594eb7b7eacb195cd0f68dda0b30f3a4.grpcweb
b65d946f28dacf24666305d622a782f77ecfaf67ad8249abf99af92cbb345d18  tx-9426056d10c69122f3913ac183ecfc30469978c94dcb27a29c08496db87320ef.grpcweb
```
