/** An authorized image request loads after the list, without blocking its rows. */
export function memberAvatarUrl(id: string) {
  return `/api/members/avatar?memberId=${encodeURIComponent(id)}`;
}
