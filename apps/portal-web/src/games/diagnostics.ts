/** UX-4: keep live diagnostics without writing unchanged attributes every frame. */
export function syncDiagnostics(host:HTMLElement,values:Record<string,string|number>){
  for(const [key,value]of Object.entries(values)){const text=String(value);if(host.dataset[key]!==text)host.dataset[key]=text;}
}
