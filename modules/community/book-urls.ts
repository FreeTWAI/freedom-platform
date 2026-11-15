export type BookRepositoryUrlFields={
  repository_url?:string|null;
  upstream_url?:string|null;
  fork_url?:string|null;
};

/** Strips a catalog book's `/fork` suffix and returns the workshop copy URL only when it differs from the original. */
export function distinctCopyUrl(forkUrl:string|null|undefined,originalUrl:string|null|undefined):string|null{
  const copyUrl=forkUrl?forkUrl.replace(/\/fork$/,''):null;
  return copyUrl&&copyUrl!==originalUrl?copyUrl:null;
}

/** Returns a book's known repository URLs (original first, distinct workshop copy last) without nulls or duplicates. */
export function bookRepositoryUrls(book:BookRepositoryUrlFields):string[]{
  const urls:string[]=[];
  for(const url of [book.repository_url,book.upstream_url,distinctCopyUrl(book.fork_url,book.repository_url)]){
    if(url&&!urls.includes(url))urls.push(url);
  }
  return urls;
}
