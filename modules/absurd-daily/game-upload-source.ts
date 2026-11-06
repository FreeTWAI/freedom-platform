import { AssetStorageError, readBounded, sha256 } from '../../packages/asset-storage/index.js';

/** Inactive native-upload foundation. This is NOT a storage profile or route. */
export const GAME_UPLOAD_SOURCE_MAX_BYTES = 256 * 1024;
export type GameUploadSourceErrorCode = 'invalid_game_source_request' | 'unsupported_game_source_type'
  | 'game_source_too_large' | 'invalid_game_source' | 'game_source_digest_unavailable';
export class GameUploadSourceError extends Error {
  constructor(readonly code: GameUploadSourceErrorCode) { super(code); this.name = 'GameUploadSourceError'; }
}
export interface ValidatedGameSource {
  readonly format: 'freedom.game-upload-source/v1';
  readonly trust: 'unreviewed';
  readonly storageState: 'not_stored';
  readonly fileName: 'index.html';
  readonly contentType: 'text/html';
  readonly byteSize: number;
  readonly sha256: string;
  /** A fresh copy every time; the exact bytes behind the digest stay private. */
  copyBytes(): Uint8Array;
}
function fail(code: GameUploadSourceErrorCode): never { throw new GameUploadSourceError(code); }

/** Accept one exact-MIME UTF-8 source, not ZIP, a URL, a path or caller authority.
 * Does not parse/sanitize HTML, verify self-containment, or execute its scripts.
 * A future HTTP adapter MUST supply current authority, transport deadlines and
 * disconnect cancellation before using this helper. Byte bounds are not timeouts.
 * The result is deliberately incompatible with PreparedRepresentation and does
 * not authorize ObjectStore, publication, iframe rendering or browser execution.
 */
export async function validateGameUploadSource(request: unknown): Promise<ValidatedGameSource> {
  let body: ReadableStream<Uint8Array>;
  let contentType: unknown;
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request)) fail('invalid_game_source_request');
    const prototype = Object.getPrototypeOf(request);
    if (prototype !== Object.prototype && prototype !== null) fail('invalid_game_source_request');
    const fields = Object.getOwnPropertyDescriptors(request);
    if (Reflect.ownKeys(fields).length !== 2 || !Object.hasOwn(fields, 'body') || !Object.hasOwn(fields, 'contentType')
      || !Object.values(fields).every(field => Object.hasOwn(field, 'value'))) fail('invalid_game_source_request');
    contentType = fields.contentType.value;
    body = fields.body.value;
    if (!(body instanceof ReadableStream)) fail('invalid_game_source_request');
  } catch { fail('invalid_game_source_request'); }
  // No stream pulls for unsupported input. This does not widen private-text or
  // media profile MIME allowlists; no storage helper consumes the result.
  if (contentType !== 'text/html') fail('unsupported_game_source_type');
  let bytes: Uint8Array;
  try { bytes = await readBounded(body, GAME_UPLOAD_SOURCE_MAX_BYTES); }
  catch (error) { fail(error instanceof AssetStorageError && error.code === 'too_large' ? 'game_source_too_large' : 'invalid_game_source'); }
  if (bytes.byteLength === 0) fail('invalid_game_source');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) fail('invalid_game_source');
  } catch { fail('invalid_game_source'); }
  // readBounded owns its returned snapshot. Keep it closure-private, including
  // the original BOM/line endings; callers cannot mutate bytes after hashing.
  let digest: string;
  try { digest = await sha256(bytes); } catch { fail('game_source_digest_unavailable'); }
  return Object.freeze({ format: 'freedom.game-upload-source/v1', trust: 'unreviewed', storageState: 'not_stored',
    fileName: 'index.html', contentType: 'text/html', byteSize: bytes.byteLength, sha256: digest,
    copyBytes: () => bytes.slice() });
}
