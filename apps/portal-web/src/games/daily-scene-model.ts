/** Shared camera/contact math. No renderer, clock or scoring authority. */
import { PerspectiveCamera, Vector3 } from 'three';
import { CLIENTS, photoPose, type Point } from './domain';
import type { StageView } from './stage';
export type DailyView = StageView & { cashDrag?: Point; stampFeedback?: { point: Point; hit: boolean; at: number } };
export type WorldPoint = readonly [number, number, number];
export type SceneRect = { left: number; top: number; width: number; height: number };
export const PAPER = { y: .086, width: 3, height: 3.7, xScale: 1.2, yScale: 1.5 } as const;
export function dailyCamera(view: StageView, aspect: number, camera = new PerspectiveCamera(44, 1, .1, 60)) {
    camera.aspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    camera.near = .1; camera.far = 60;
    if (view.game === 'photo') {
        camera.position.set(view.pan.x, 1.95 + view.pan.y, 6);
        camera.fov = view.fov;
        camera.lookAt(view.pan.x, 1.95 + view.pan.y, 0);
    } else {
        camera.position.set(0, 5.3, 2.7);
        camera.fov = view.game === 'stamp' ? 40 : 42;
        camera.lookAt(0, 0, .23);
    }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    return camera;
}
/** NDC coordinates, including depth; callers decide clipping. */
export function project(camera: PerspectiveCamera, point: WorldPoint) {
    return new Vector3(...point).project(camera);
}
function rotate(point: WorldPoint, angle: number, offset: WorldPoint): WorldPoint {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [point[0] * c - point[1] * s + offset[0], point[0] * s + point[1] * c + offset[1], point[2] + offset[2]];
}
export function photoTransforms(view: StageView) {
    const pose = photoPose(CLIENTS[view.client].id, view.seconds, view.seed);
    const client = (p: WorldPoint) => rotate(p, view.motion ? pose.sway : 0, [0, pose.lift, 0]);
    const board = (p: WorldPoint) => rotate(p, view.motion ? Math.sin(view.seconds * 4) * .025 : 0, [pose.boardX, 0, 1.1]);
    const bird = (i: number, p: WorldPoint) => client(rotate(p, view.motion ? Math.sin(view.seconds * 3 + i) * .12 : 0, [[0, -.20, .21][i], [2.96, 2.08, 1.08][i], .5 + pose.birds[i]]));
    return { pose, client, board, bird };
}
export function photoAnchors(view: StageView) {
    const { client, board, bird, pose } = photoTransforms(view);
    const anchors: { id: string; visible: boolean; points: WorldPoint[] }[] = [
        { id: 'head', visible: true, points: [client([-.65, 3.78, 0]), client([.65, 2.65, .5])] },
        { id: 'feet', visible: true, points: [client([-.5, .02, .55]), client([.5, .02, .55])] },
    ];
    const id = CLIENTS[view.client].id;
    if (id === 'backdrop') anchors.push({ id: 'board', visible: true, points: [board([-.91, 3.12, .2]), board([.91, .04, .3])] });
    if (id === 'umbrella') anchors.push({ id: 'umbrella', visible: true, points: [client([-.66, 4.94, 0]), client([2.28, 4.1, .6])] });
    if (id === 'pigeons') for (let i = 0; i < 3; i++) anchors.push({ id: `bird${i}`, visible: pose.birds[i] > 0, points: [bird(i, [-.3, .35, .4]), bird(i, [.3, -.3, .4])] });
    return anchors;
}
export function photoFraming(view: StageView, aspect: number) {
    if (view.game !== 'photo') return { visible: [], blocked: false, lift: 0 };
    const camera = dailyCamera(view, aspect), pose = photoTransforms(view).pose;
    return { visible: photoAnchors(view).filter(a => a.visible && a.points.every(p => {
        const v = project(camera, p); return v.z >= -1 && v.z <= 1 && Math.abs(v.x) <= .97 && Math.abs(v.y) <= .97;
    })).map(a => a.id), blocked: CLIENTS[view.client].id === 'backdrop' && Math.abs(pose.boardX) < .85, lift: pose.lift };
}
export function planePoint(camera: PerspectiveCamera, ndc: Point, height: number): Vector3 | null {
    const origin = camera.position, direction = new Vector3(ndc.x, ndc.y, .5).unproject(camera).sub(origin).normalize();
    if (Math.abs(direction.y) < 1e-9) return null;
    const distance = (height - origin.y) / direction.y;
    return distance >= 0 ? direction.multiplyScalar(distance).add(origin) : null;
}
function pointerNdc(rect: SceneRect, x: number, y: number): Point | null {
    if (!(rect.width > 0 && rect.height > 0) || !Number.isFinite(x + y) || x < rect.left || x > rect.left + rect.width || y < rect.top || y > rect.top + rect.height) return null;
    return { x: (x - rect.left) / rect.width * 2 - 1, y: 1 - (y - rect.top) / rect.height * 2 };
}
export function paperPoint(view: StageView, rect: SceneRect, x: number, y: number): Point | null {
    const ndc = pointerNdc(rect, x, y);
    if (!ndc || view.game !== 'stamp') return null;
    const p = planePoint(dailyCamera(view, rect.width / rect.height), ndc, PAPER.y);
    if (!p || Math.abs(p.x) > PAPER.width / 2 + 1e-9 || Math.abs(p.z) > PAPER.height / 2 + 1e-9) return null;
    return { x: p.x / PAPER.xScale, y: p.z / PAPER.yScale };
}
function cashFeedbackPose(view: DailyView) {
    const dt = Math.max(0, view.seconds * 1000 - (view.cash?.lastAt ?? 0));
    return {
        shake: view.motion && view.cash?.feedback === 'wrong' ? Math.sin(dt * .045) * Math.exp(-dt / 85) * .18 : 0,
        y: .33 + (view.motion && view.cash?.feedback === 'correct' ? Math.exp(-dt / 80) * .12 : 0),
    };
}
export function cashDragOffset(view: DailyView, aspect: number) {
    const { y } = cashFeedbackPose(view);
    const camera = dailyCamera(view, aspect), center = project(camera, [0, y, 0]);
    const p = planePoint(camera, { x: center.x + (view.cashDrag?.x ?? 0) * 2, y: center.y - (view.cashDrag?.y ?? 0) * 2 }, y);
    return { x: p?.x ?? 0, z: p?.z ?? 0 };
}
/** Actual current world-space card plane, shared by drawing and pointer contact. */
export function cashCardPose(view: DailyView, aspect: number) {
    const feedback = cashFeedbackPose(view), drag = cashDragOffset(view, aspect);
    return { x: drag.x + feedback.shake, y: feedback.y, z: drag.z };
}
export function cashContains(view: DailyView, rect: SceneRect, x: number, y: number) {
    const ndc = pointerNdc(rect, x, y);
    if (!ndc || view.game !== 'cash' || !view.cash || view.cash.endedAt !== null) return false;
    const aspect = rect.width / rect.height, pose = cashCardPose(view, aspect);
    const p = planePoint(dailyCamera(view, aspect), ndc, pose.y);
    return !!p && Math.abs(p.x - pose.x) <= 1.6 && Math.abs(p.z - pose.z) <= 1.075;
}
export function letterboxRect(width: number, height: number, targetWidth = 960, targetHeight = 720) {
    const scale = Math.min(targetWidth / Math.max(1, width), targetHeight / Math.max(1, height));
    const w = width * scale, h = height * scale;
    return { x: (targetWidth - w) / 2, y: (targetHeight - h) / 2, width: w, height: h };
}
/** Synchronous readback of the actual current frame, preserving its camera aspect. */
export function captureDailyFrame(source: HTMLCanvasElement) {
    const output = document.createElement('canvas'); output.width = 960; output.height = 720;
    const ctx = output.getContext('2d');
    if (!ctx) throw Error('圖片無法產生：瀏覽器未提供 Canvas 2D。');
    ctx.fillStyle = '#f8f2e8'; ctx.fillRect(0, 0, 960, 720);
    const box = letterboxRect(source.width, source.height);
    ctx.drawImage(source, box.x, box.y, box.width, box.height);
    return output.toDataURL('image/jpeg', .9);
}
