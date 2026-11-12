export function verifyGuildToolToken(token:string,options:{issuer:string;audience:string;jwks:{keys:Record<string,unknown>[]}}):Promise<Record<string,any>>;
