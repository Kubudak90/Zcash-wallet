/**
 * An address set in groups of four characters, so it can be read out and
 * compared group by group. The groups are spans with no text between them:
 * the element's text, a copy by hand and what tests read stay the address
 * itself, character for character. The first and last `edge` groups, the
 * ones people compare, are set apart (CSS: .g-edge).
 */
export function GroupedAddress({ value, edge = 2 }: { value: string; edge?: number }) {
  const groups = value.match(/.{1,4}/g) ?? [];
  return (
    <>
      {groups.map((group, i) => (
        <span key={i} className={i < edge || i >= groups.length - edge ? 'g g-edge' : 'g'}>
          {group}
        </span>
      ))}
    </>
  );
}
