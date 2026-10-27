/** The private email capability is read only from a fragment, never a query or storage. */
export function readEventParticipationToken(hash=window.location.hash):string|null{
  const match=/^#participation=([A-Za-z0-9_-]{43})$/.exec(hash);
  return match?.[1]??null;
}
