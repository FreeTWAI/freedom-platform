const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function singlePostId(search: string, key: string): string | null {
  const values = new URLSearchParams(search).getAll(key);
  return values.length === 1 && values[0].length === 36 && UUID.test(values[0]) ? values[0].toLowerCase() : null;
}

/** A post return is a UUID, never a caller-provided URL. Other entry flows keep
 * their own return keys and cannot be replaced by an ambiguous post intent. */
export function publicPostReturn(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.has('return_to') || params.has('skill_acquisition') || params.has('social-post')) return null;
  const id = singlePostId(search, 'post_return');
  return id ? `/posts/${id}` : null;
}

export function memberPostReturn(search: string, hash: string): string | null {
  const params = new URLSearchParams(search);
  if (hash !== '#account' || params.has('post_return') || params.has('return_to') || params.has('skill_acquisition')) return null;
  const id = singlePostId(search, 'social-post');
  return id ? `/?social-post=${id}#social` : null;
}

export function anonymousSharedPost(search: string, hash: string): string | null {
  if (hash !== '#social') return null;
  const params = new URLSearchParams(search);
  if (params.has('post_return') || params.has('return_to') || params.has('skill_acquisition')) return null;
  const id = singlePostId(search, 'social-post');
  return id ? `/posts/${id}` : null;
}
