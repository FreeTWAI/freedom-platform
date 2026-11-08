import {LatheGeometry, Vector2} from 'three';

/** Original turned-tool profile: flared foot, waisted shaft and domed grip.
 * Model units are the existing stamp's units. This is a solid rotational mesh,
 * not a texture/billboard or a collision/scoring change. Caller owns disposal. */
export function createStampHandleGeometry() {
    const geometry = new LatheGeometry([
        [0, .18], [.13, .18], [.17, .20], [.17, .25], [.13, .29],
        [.095, .34], [.09, .49], [.12, .59], [.21, .65], [.26, .72],
        [.25, .81], [.18, .88], [.08, .91], [0, .91],
    ].map(([radius, height]) => new Vector2(radius, height)), 32);
    // LatheGeometry leaves the terminal axial normal at profile-edge length.
    geometry.normalizeNormals();
    return geometry;
}
