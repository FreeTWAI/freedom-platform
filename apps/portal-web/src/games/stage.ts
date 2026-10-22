import { ACESFilmicToneMapping, HemisphereLight, PCFSoftShadowMap, PMREMGenerator, BoxGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Plane, PlaneGeometry, Raycaster, Scene, SphereGeometry, SRGBColorSpace, TorusGeometry, Vector2, Vector3, WebGLRenderer, type BufferGeometry, type Material } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { cashDeck, CLIENTS, documentTitle, photoPose, RULES, stampTarget, type CashState, type GameId, type Point, type StampState } from './domain';
export type StageView = {
    game: GameId;
    seed: number;
    seconds: number;
    client: number;
    pan: Point;
    fov: number;
    stamp?: StampState;
    stampPoint: Point;
    raised: boolean;
    cash?: CashState;
    motion: boolean;
};
export type Stage = {
    update: (view: StageView) => void;
    capture: () => string;
    framing: () => {
        visible: string[];
        blocked: boolean;
        lift: number;
    };
    point: (clientX: number, clientY: number) => Point | null;
    dispose: () => void;
    stats: () => {
        calls: number;
        triangles: number;
        geometries: number;
        textures: number;
    };
};
type Anchor = {
    id: string;
    object: Group;
    points: Vector3[];
};
const INK = '#302744', LIME = '#ffc857', BLUE = '#5062cb', PAPER = '#fff1d5';
/** AD-6: all geometry/material/texture ownership is per mounted stage. */
export function createStage(host: HTMLElement, onLost: () => void): Stage {
    const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RULES.maxDpr));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.append(renderer.domElement);
    const scene = new Scene();
    scene.background = new Color('#ba9bdf');
    const camera = new PerspectiveCamera(44, 4 / 3, .1, 60), ray = new Raycaster(), ground = new Plane(new Vector3(0, 1, 0), 0), intersection = new Vector3();
    scene.add(new HemisphereLight('#fff2da', '#785f9b', 2.15));
    const pmrem = new PMREMGenerator(renderer), room = new RoomEnvironment(), environment = pmrem.fromScene(room, .06);
    scene.environment = environment.texture;
    scene.environmentIntensity = .42;
    room.dispose();
    pmrem.dispose();
    const key = new DirectionalLight('#fff1d7', 4.2);
    key.position.set(-3.5, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 7, bottom: -4, near: .5, far: 18 });
    key.shadow.bias = -.0004;
    key.shadow.normalBias = .025;
    key.shadow.radius = 3;
    scene.add(key);
    const rim = new DirectionalLight('#bdc7ff', 2.4);
    rim.position.set(5, 3, -3);
    scene.add(rim);
    const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<CanvasTexture>();
    const geo = <T extends BufferGeometry>(value: T): T => { geometries.add(value); return value; };
    const round = geo(new RoundedBoxGeometry(1, 1, 1, 3, .12)), sphere = geo(new SphereGeometry(1, 24, 16)), cylinder = geo(new CylinderGeometry(1, 1, 1, 24)), cone = geo(new CylinderGeometry(0, 1, 1, 24)), plane = geo(new PlaneGeometry(1, 1)), box = geo(new BoxGeometry(1, 1, 1));
    const torus = geo(new TorusGeometry(1, .09, 10, 40)), arch = geo(new TorusGeometry(1, .09, 10, 36, Math.PI)), coat = geo(new CylinderGeometry(.72, 1, 1, 32));
    const palette = new Map<string, MeshStandardMaterial>();
    function mat(color: string, metalness = 0, roughness = .42) { const id = `${color}/${metalness}/${roughness}`; let m = palette.get(id); if (!m) {
        m = new MeshStandardMaterial({ color, metalness, roughness });
        materials.add(m);
        palette.set(id, m);
    } return m; }
    function mesh(parent: Group, g: BufferGeometry, color: string, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, metalness = 0) { const m = new Mesh(g, mat(color, metalness)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }
    const rb = (p: Group, c: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, metal = 0) => mesh(p, round, c, x, y, z, sx, sy, sz, metal);
    const ball = (p: Group, c: string, x: number, y: number, z: number, sx: number, sy = sx, sz = sx) => mesh(p, sphere, c, x, y, z, sx, sy, sz);
    function group(parent: Group, x = 0, y = 0, z = 0) { const g = new Group(); g.position.set(x, y, z); parent.add(g); return g; }
    function texture(draw: (ctx: CanvasRenderingContext2D, c: HTMLCanvasElement) => void, width = 768, height = 1024) { const c = document.createElement('canvas'); c.width = width; c.height = height; const ctx = c.getContext('2d'); if (!ctx)
        throw Error('無法建立遊戲圖像。'); draw(ctx, c); const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; textures.add(t); return t; }
    function texturedPlane(parent: Group, t: CanvasTexture, w: number, h: number) { const m = new MeshBasicMaterial({ map: t, toneMapped: false }); materials.add(m); const object = new Mesh(plane, m); object.scale.set(w, h, 1); parent.add(object); return object; }
    function label(parent: Group, title: string, sub: string, x: number, y: number, z: number, w = 2, h = .8) { const t = texture((ctx, c) => { ctx.fillStyle = INK; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = LIME; ctx.font = 'bold 56px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(title, c.width / 2, 90); ctx.fillStyle = PAPER; ctx.font = '30px sans-serif'; ctx.fillText(sub, c.width / 2, 150); }, 768, 210); const m = texturedPlane(parent, t, w, h); m.position.set(x, y, z); return m; }
    function shadow(parent: Group, x: number, z: number, sx: number, sz: number) { const m = mesh(parent, cylinder, '#c0c9b1', x, .012, z, sx, .014, sz); return m; }
    let world = new Group();
    scene.add(world);
    let keyId = '', lastView: StageView | null = null, disposed = false, ready = false;
    let clientRoot: Group | null = null, board: Group | null = null, birds: Group[] = [], anchors: Anchor[] = [], stampRoot: Group | null = null, paperMesh: Mesh | null = null, paperMat: MeshBasicMaterial | null = null, paperKey = '', paperTexture: CanvasTexture | null = null, cashMesh: Mesh | null = null, cashKey = '', tower: Group | null = null, crab: Group | null = null, lamp: Group | null = null;
    function rod(p: Group, c: string, a: Vector3, b: Vector3, r = .04) { const m = mesh(p, cylinder, c, 0, 0, 0, r, a.distanceTo(b), r); m.position.copy(a).add(b).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize()); return m; }
    function eye(p: Group, x: number, y: number, z: number, size = .16, look = 0) { ball(p, PAPER, x, y, z, size, size * 1.13, size * .72); ball(p, INK, x + look, y - .005, z + size * .66, size * .48, size * .61, size * .28); ball(p, '#fffaf0', x + look - size * .13, y + size * .22, z + size * .9, size * .13); }
    let studioTemplate:Group|null=null;
    function studio() {
        if(studioTemplate){world.add(studioTemplate.clone(true));return;}
        scene.background = new Color('#ba9bdf');
        rb(world, '#c7a6e0', 0, 2.5, -2.1, 11, 7, .35);
        rb(world, '#e9b6aa', 0, -.19, 0, 12, .3, 10);
        const floor = texture((ctx) => { for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++) {
                ctx.fillStyle = (x + y) % 2 ? '#efc9b3' : '#f7dfc6';
                ctx.fillRect(x * 64, y * 64, 64, 64);
            } }, 512, 512);
        const tiles = texturedPlane(world, floor, 9, 9);
        tiles.rotation.x = -Math.PI / 2;
        tiles.position.y = -.025;
        tiles.receiveShadow = true;
        mesh(world, arch, PAPER, 0, 2.55, -1.75, 2.05, 2.05, .65);
        for (const side of [-1, 1])
            mesh(world, cylinder, PAPER, side * 2.05, 1.25, -1.75, .185, 2.55, .14);
        rb(world, '#9779bc', 0, 2.1, -1.84, 3.75, 4.15, .08);
        const sign = label(world, '怪事照相館', 'ODD JOBS · PHOTO CLUB', 0, 4.36, -1.6, 2.6, .53);
        sign.rotation.z = -.035;
        mesh(world, cylinder, '#de9b9a', 0, -.02, 0, 1.34, .12, 1.34);
        mesh(world, cylinder, PAPER, 0, .035, 0, 1.22, .10, 1.22);
        for (const side of [-1, 1]) {
            const g = group(world, side * 2.43, 0, -.25);
            rod(g, INK, new Vector3(0, 0, 0), new Vector3(0, 2.8, 0), .035);
            for (let i = 0; i < 3; i++) {
                const a = i * Math.PI * 2 / 3;
                rod(g, INK, new Vector3(0, .45, 0), new Vector3(Math.sin(a) * .42, .04, Math.cos(a) * .42), .035);
            }
            const soft = group(g, 0, 2.65, 0);
            soft.rotation.y = -side * .35;
            soft.rotation.z = -side * .08;
            rb(soft, BLUE, 0, 0, -.04, .78, 1.12, .20);
            rb(soft, PAPER, 0, 0, .08, .68, 1.02, .07);
            for (let j = -1; j <= 1; j++)
                rb(soft, '#ead7c2', j * .18, 0, .12, .012, .96, .01);
        }
        const plant = group(world, -2.9, 0, -.8);
        plant.scale.setScalar(.8);
        mesh(plant, coat, '#ec6549', 0, .36, 0, .35, .7, .35);
        mesh(plant, cylinder, PAPER, 0, .72, 0, .38, .1, .38);
        for (let i = 0; i < 5; i++) {
            const a = i * 2.4, e = new Vector3(Math.sin(a) * .5, 1.2 + i * .1, Math.cos(a) * .32);
            rod(plant, '#3f9c96', new Vector3(0, .65, 0), e, .035);
            const leaf = ball(plant, i % 2 ? '#3f9c96' : '#7bb387', e.x, e.y, e.z, .2, .38, .10);
            leaf.rotation.z = -Math.sin(a) * .8;
        }
        const frame = group(world, 2.9, 1.1, -1.79);
        frame.rotation.z = -.14;
        rb(frame, LIME, 0, 0, 0, .85, 1.05, .14);
        label(frame, '今日', '正常客人：0', 0, 0, .08, .71, .8);
        rb(world, '#ec6549', 0, .1, .38, .65, .012, .065).rotation.y = .16;
        // AD-6: bake only the stationary set, keeping animated clients and anchors separate.
        // Reuse it for all three customers; group by material and shadow behavior.
        const set=new Group();for(const child of [...world.children])set.add(child);
        world.add(set);set.updateMatrixWorld(true);
        const batches=new Map<Material,{cast:boolean;receive:boolean;pieces:BufferGeometry[]}[]>();
        set.traverse(object=>{if(!(object instanceof Mesh)||Array.isArray(object.material))return;
          const pieces=batches.get(object.material)??[];
          let batch=pieces.find(b=>b.cast===object.castShadow&&b.receive===object.receiveShadow);
          if(!batch){batch={cast:object.castShadow,receive:object.receiveShadow,pieces:[]};pieces.push(batch);batches.set(object.material,pieces);}
          const cloned=object.geometry.clone(),piece=cloned.index?cloned.toNonIndexed():cloned;
          if(piece!==cloned)cloned.dispose();
          batch.pieces.push(piece.applyMatrix4(object.matrixWorld));
        });
        const baked:Mesh[]=[];
        for(const [material,batchesForMaterial] of batches)for(const batch of batchesForMaterial){
          const geometry=mergeGeometries(batch.pieces,false);
          if(!geometry){batch.pieces.forEach(g=>g.dispose());throw Error('攝影棚模型未能準備。');}
          geo(geometry);const m=new Mesh(geometry,material);m.castShadow=batch.cast;m.receiveShadow=batch.receive;baked.push(m);
          batch.pieces.forEach(g=>g.dispose());
        }
        set.clear();set.add(...baked);studioTemplate=set;
    }
    function shoe(p: Group, x: number) { mesh(p, cylinder, INK, x, .62, 0, .13, .84, .13); rb(p, '#ec6549', x, .22, .19, .43, .30, .72); rb(p, PAPER, x, .095, .20, .45, .09, .73); ball(p, '#f78b6e', x, .28, .44, .20, .12, .21); for (let i = 0; i < 3; i++)
        rb(p, PAPER, x, .378, .14 + i * .09, .23, .025, .03).rotation.z = (i - 1) * .08; }
    function human(parent: Group, pigeon = false) {
        const p = group(parent), fabric = pigeon ? '#c99860' : BLUE, lapel = pigeon ? '#f1c28c' : '#8792e0';
        shoe(p, -.29);
        shoe(p, .29);
        mesh(p, coat, fabric, 0, 1.55, 0, .78, 1.68, .46);
        ball(p, fabric, 0, 2.18, -.01, .58, .39, .37);
        rb(p, PAPER, 0, 2.31, .34, .34, .42, .08);
        for (const side of [-1, 1]) {
            rb(p, lapel, side * .20, 2.21, .40, .31, .62, .10).rotation.z = side * .4;
            const arm = group(p, side * .65, 2.15, 0);
            arm.rotation.z = side * .16;
            ball(arm, fabric, 0, -.07, 0, .25, .31, .28);
            mesh(arm, cylinder, fabric, 0, -.51, .015, .18, .82, .20);
            mesh(arm, cylinder, lapel, 0, -.92, .02, .193, .13, .21);
            ball(arm, '#f7b582', 0, -1.12, .075, .19, .23, .17);
            ball(arm, '#ef9b6b', -side * .16, -1.07, .17, .09, .14, .095);
            for (let i = 0; i < 3; i++)
                rb(arm, '#db8e61', (i - 1) * .075, -1.20, .225, .018, .09, .012);
            rb(p, pigeon ? '#93683f' : '#3d4ca9', side * .38, 1.23, .40, .33, .055, .06);
        }
        rb(p, pigeon ? '#95683e' : '#35448e', 0, 1.61, .46, 1.24, .10, .08);
        rb(p, LIME, .1, 1.61, .52, .22, .16, .07, .65);
        for (let i = 0; i < 4; i++)
            ball(p, LIME, -.075, 1.01 + i * .28, .455, .065, .065, .028);
        if (!pigeon) {
            const head = group(p, 0, 2.95, .015);
            ball(head, '#f7b582', 0, 0, 0, .57, .64, .48);
            for (const side of [-1, 1]) {
                ball(head, '#f7b582', side * .56, -.02, 0, .13, .20, .13);
                ball(head, '#ee9878', side * .60, -.015, .05, .055, .10, .07);
                eye(head, side * .235, .12, .41, .185, .025);
                mesh(head, torus, INK, side * .235, .12, .57, .236, .235, .20);
                ball(head, '#ec8c7f', side * .36, -.12, .42, .13, .08, .04);
                rb(head, '#7e4133', side * .23, .43, .40, .27, .07, .065).rotation.z = side * .1;
                ball(head, '#794333', side * .11, -.28, .45, .15, .055, .055).rotation.z = side * .24;
            }
            rb(head, INK, 0, .13, .58, .10, .04, .05);
            ball(head, '#ef986f', 0, -.035, .60, .185, .20, .24);
            ball(head, INK, 0, -.36, .41, .08, .035, .025);
            for (const [x, y, z, r] of [[-.35, .44, .04, .24], [0, .56, -.02, .28], [.31, .47, .02, .24], [-.15, .68, .13, .23], [.12, .72, .08, .23]])
                ball(head, '#93482e', x, y, z, r, r * .88, r * .84);
            mesh(p, cone, LIME, 0, 2.06, .48, .12, .40, .05).rotation.z = Math.PI;
            rb(p, PAPER, .37, 2.13, .48, .25, .15, .025);
        }
        return p;
    }
    function pigeon(parent: Group, x: number, y: number, index = 0) {
        const b = group(parent, x, y, .5), f = ['#799eae', '#8e9bc0', '#789b9a'][index];
        ball(b, f, 0, -.10, 0, .39, .43, .30);
        ball(b, '#bfd1d1', 0, .10, .07, .34, .34, .29);
        ball(b, index === 1 ? '#ba9bdf' : '#3f9c96', 0, -.27, .18, .29, .13, .13);
        for (const side of [-1, 1]) {
            eye(b, side * .17, .14, .29, .125, (index - 1) * .025);
            rb(b, INK, side * .17, .34, .28, .20, .04, .03).rotation.z = side * (index === 2 ? -.35 : .15);
            ball(b, f, side * .34, -.26, 0, .15, .29, .20).rotation.z = side * .2;
        }
        ball(b, LIME, 0, -.015, .46, .14, .07, .20).rotation.x = -.18;
        rb(b, '#b87e46', 0, -.04, .59, .16, .014, .06);
        for (let i = 0; i < 3; i++)
            ball(b, f, (i - 1) * .08, .43 + (i === 1 ? .025 : 0), -.01, .055, .14, .05).rotation.z = (i - 1) * -.3;
        return b;
    }
    function buildPhoto(view: StageView) {
        studio();
        const client = CLIENTS[view.client].id;
        clientRoot = human(world, client === 'pigeons');
        anchors = [{ id: 'head', object: clientRoot, points: [new Vector3(-.65, 3.78, 0), new Vector3(.65, 2.65, .5)] }, { id: 'feet', object: clientRoot, points: [new Vector3(-.5, .02, .55), new Vector3(.5, .02, .55)] }];
        if (client === 'backdrop') {
            board = group(world, 0, 0, 1.1);
            rb(board, '#df7956', 0, 1.7, 0, 1.75, 2.82, .28);
            rb(board, LIME, 0, 1.7, .14, 1.58, 2.62, .08);
            for (const side of [-1, 1]) {
                eye(board, side * .30, 2.06, .25, .20, -.02);
                rb(board, INK, side * .30, 2.40, .24, .32, .065, .05).rotation.z = -side * .16;
                rb(board, '#ec6549', side * .96, 1.58, .04, .4, .15, .17).rotation.z = side * .35;
                ball(board, PAPER, side * 1.12, 1.69, .12, .14, .14, .12);
                rb(board, '#ec6549', side * .43, .22, .20, .28, .36, .53);
                rb(board, PAPER, side * .43, .09, .24, .29, .07, .55);
            }
            ball(board, INK, 0, 1.61, .25, .25, .16, .035);
            ball(board, '#fa789a', 0, 1.54, .285, .16, .06, .02);
            label(board, '我也要拍', 'BACKGROUND MAIN CHARACTER', 0, .93, .20, 1.35, .34);
            anchors.push({ id: 'board', object: board, points: [new Vector3(-.91, 3.12, .2), new Vector3(.91, .04, .3)] });
        }
        if (client === 'umbrella') {
            const u = group(clientRoot);
            rod(u, PAPER, new Vector3(.80, 1.45, .06), new Vector3(.8, 4.35, .06), .035);
            ball(u, '#fa789a', .8, 4.21, .06, 1.42, .52, 1.13);
            ball(u, '#df668c', .8, 4.13, .06, 1.40, .16, 1.11);
            for (let i = 0; i < 8; i++) {
                const a = i * Math.PI / 4, x = .8 + Math.sin(a) * 1.32, z = .06 + Math.cos(a) * 1.02;
                rod(u, '#f5afba', new Vector3(.8, 4.54, .06), new Vector3(x, 4.12, z), .018);
                ball(u, PAPER, x, 4.11, z, .055);
            }
            ball(u, LIME, .8, 4.73, .06, .09, .19, .09);
            mesh(u, torus, LIME, .68, 1.47, .06, .16, .20, .13).rotation.x = Math.PI / 2;
            anchors.push({ id: 'umbrella', object: clientRoot, points: [new Vector3(-.66, 4.94, 0), new Vector3(2.28, 4.1, .6)] });
        }
        if (client === 'pigeons') {
            birds = [pigeon(clientRoot, 0, 2.96, 0), pigeon(clientRoot, -.20, 2.08, 1), pigeon(clientRoot, .21, 1.08, 2)];
            birds.forEach((b, i) => anchors.push({ id: `bird${i}`, object: b, points: [new Vector3(-.3, .35, .4), new Vector3(.3, -.3, .4)] }));
        }
    }
    function desk() {
        scene.background = new Color('#8aa8ba');
        rb(world, '#70a29e', 0, -.18, 0, 8, .30, 6.5);
        rb(world, '#397e83', 0, -.38, 0, 8, .12, 6.5);
        rb(world, '#457a8a', 0, .7, -2.8, 8, 1.8, .15);
        rb(world, '#e5b48b', 0, .005, .15, 3.60, .08, 4.35);
        rb(world, '#f1c99e', 0, .05, .15, 3.48, .02, 4.21);
        const g = group(world, -2.45, 0, .8);
        mesh(g, cylinder, PAPER, 0, .06, 0, .39, .05, .39);
        mesh(g, cylinder, '#fa789a', 0, .31, 0, .26, .49, .26);
        mesh(g, cylinder, '#70423a', 0, .565, 0, .22, .015, .22);
        mesh(g, torus, '#fa789a', .29, .33, 0, .17, .19, .14).rotation.y = Math.PI / 2;
        ball(g, PAPER, 0, .31, .256, .13, .08, .015);
        eye(g, -.05, .32, .275, .035);
        eye(g, .05, .32, .275, .035);
        lamp = group(world, -2.5, 0, -1.75);
        mesh(lamp, cylinder, PAPER, 0, .07, 0, .44, .15, .44);
        rod(lamp, LIME, new Vector3(0, .12, 0), new Vector3(0, 1.6, 0), .07);
        rod(lamp, LIME, new Vector3(0, 1.6, 0), new Vector3(.6, 2, -.1), .075);
        ball(lamp, LIME, 0, 1.6, 0, .12);
        mesh(lamp, cone, '#fa789a', .70, 1.9, -.05, .42, .50, .42).rotation.z = -.4;
        ball(lamp, PAPER, .74, 1.7, .01, .29, .04, .29);
        label(world, '下班事務所', '認真處理不正常的事', 0, .52, -2.68, 2.1, .52);
        mesh(world, cylinder, '#ec6549', 2.65, .25, -1.65, .23, .5, .23);
        for (let i = 0; i < 3; i++) {
            const pen = group(world, 2.65 + (i - 1) * .08, .4, -1.65);
            pen.rotation.z = (i - 1) * .15;
            mesh(pen, cylinder, i % 2 ? BLUE : LIME, 0, .36, 0, .026, .8, .026);
            mesh(pen, cone, '#a77952', 0, .80, 0, .026, .10, .026);
        }
        rb(world, LIME, -2.25, .055, 1.6, .08, .08, 1.0).rotation.y = -.4;
    }
    function buildStamp() { desk(); paperMat = new MeshBasicMaterial({ color: PAPER, toneMapped: false }); materials.add(paperMat); paperMesh = new Mesh(plane, paperMat); paperMesh.scale.set(3, 3.7, 1); paperMesh.rotation.x = -Math.PI / 2; paperMesh.position.y = .086; world.add(paperMesh); stampRoot = group(world, 0, .4, 0); rb(stampRoot, '#ec6549', 0, .09, 0, .46, .18, .43); rb(stampRoot, INK, 0, .005, 0, .49, .025, .47); mesh(stampRoot, cylinder, BLUE, 0, .44, 0, .11, .6, .11); ball(stampRoot, BLUE, 0, .8, 0, .23, .18, .20); rb(stampRoot, LIME, 0, .81, .18, .22, .06, .05); tower = group(world, 2.5, .03, -.6); for (let i = 0; i < 12; i++) {
        const page = rb(tower, PAPER, Math.sin(i) * .04, i * .065, 0, 1.35, .055, 1.7);
        page.name = `sheet${i}`;
        page.rotation.y = Math.sin(i) * .025;
    } crab = group(world, 1.98, .2, .10); ball(crab, '#ec785a', 0, .13, 0, .34, .18, .25); for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
            const leg = rb(crab, '#d98565', side * .3, 0, (i - 1) * .17, .5, .055, .055);
            leg.rotation.y = side * (i - 1) * .3;
        }
        mesh(crab, cylinder, '#d98565', side * .15, .39, .07, .025, .35, .025);
        ball(crab, PAPER, side * .15, .58, .07, .07);
        ball(crab, INK, side * .15, .59, .13, .03);
        ball(crab, '#ec785a', side * .48, .2, .18, .18, .15, .09);
    } }
    function buildCash() { desk(); const cardGroup = group(world, 0, .08, 0); cashMesh = new Mesh(plane, new MeshBasicMaterial({ color: PAPER, toneMapped: false })); materials.add(cashMesh.material as Material); cashMesh.scale.set(3.2, 2.15, 1); cashMesh.rotation.x = -Math.PI / 2; cashMesh.position.y = .25; cardGroup.add(cashMesh); tower = group(world, 2.6, .04, -.15); for (let i = 0; i < 24; i++) {
        const m = rb(tower, LIME, Math.sin(i) * .03, i * .025, 0, 1.3, .022, 1.85);
        m.name = `bill${i}`;
    } rb(world, '#e9ad9e', -2.7, .04, 0, 1.6, .1, 2.3); rb(world, INK, -2.7, .13, -1.1, 1.6, .2, .12); label(world, '退票券', '非現金，不用感動', -2.7, .45, -1.15, 1.5, .45); ball(world, '#d6a36d', -2.7, .27, .6, .48, .15, .4); for (let i = -2; i <= 2; i++) {
        const cut = rb(world, '#9c693e', -2.7 + i * .16, .39, .6, .035, .012, .5);
        cut.rotation.y = .4;
    } for (let i = 0; i < 8; i++)
        rb(cardGroup, '#9cab71', Math.sin(i) * .015, .025 + i * .026, 0, 3.2, .023, 2.15); }
    function replaceTexture(target: MeshBasicMaterial, t: CanvasTexture) { if (target.map) {
        textures.delete(target.map as CanvasTexture);
        target.map.dispose();
    } target.map = t; target.needsUpdate = true; }
    function updatePaper(s: StampState) { const id = `${s.index}/${s.practice}/${s.marks.map(m => `${m.x.toFixed(2)},${m.y.toFixed(2)},${m.hit}`).join(';')}`; if (id === paperKey || !paperMat)
        return; paperKey = id; paperTexture = texture((ctx, c) => { ctx.fillStyle = PAPER; ctx.fillRect(0, 0, c.width, c.height); ctx.strokeStyle = '#aeb5c2'; ctx.lineWidth = 3; ctx.strokeRect(35, 35, 698, 954); ctx.fillStyle = INK; ctx.font = 'bold 45px sans-serif'; ctx.textAlign = 'left'; const title = documentTitle(Math.min(s.index, 11), s.practice); ctx.fillText(title.slice(0, 11), 65, 120); if (title.length > 11)
        ctx.fillText(title.slice(11), 65, 180); ctx.font = '28px sans-serif'; ctx.fillText(s.practice ? '先蓋中一次，再正式上班' : `公文 ${Math.min(s.index + 1, 12)} / 12　 收發室：螃蟹`, 65, 230); ctx.fillStyle = '#d8c3ab'; for (let i = 0; i < 4; i++)
        ctx.fillRect(70, 290 + i * 45, 500 - i * 40, 7); const target = stampTarget(s.seed, Math.min(s.index, 11)), x = 384 + target.x * 307, y = 512 + target.y * 415; ctx.strokeStyle = BLUE; ctx.lineWidth = 6; ctx.setLineDash([12, 9]); ctx.beginPath(); ctx.arc(x, y, RULES.stampRadius * 307, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.font = '26px sans-serif'; ctx.fillStyle = BLUE; ctx.textAlign = 'center'; ctx.fillText('蓋這裡', x, y + 100); for (const m of s.marks) {
        const mx = 384 + m.x * 307, my = 512 + m.y * 415;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(m.x * .2);
        ctx.strokeStyle = m.hit ? '#487300' : '#a53c4b';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 9;
        ctx.strokeRect(-62, -52, 124, 104);
        ctx.font = 'bold 46px sans-serif';
        ctx.fillText('已閱', 0, 17);
        ctx.restore();
    } ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.font = '26px sans-serif'; ctx.fillText('備註：已閱，但看不懂。', 65, 937); }); replaceTexture(paperMat, paperTexture); }
    function updateCash(s: CashState) {
        const card = cashDeck(s.seed)[Math.min(s.index, 29)], id = String(card.id);
        if (id === cashKey || !cashMesh)
            return;
        cashKey = id;
        const t = texture((ctx, c) => {
            ctx.fillStyle = card.valid ? '#c8d6ac' : '#f4c6be';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.strokeStyle = card.valid ? '#61866a' : '#bf737b';
            ctx.lineWidth = 4;
            ctx.strokeRect(18, 18, 988, 604);
            ctx.strokeRect(31, 31, 962, 578);
            ctx.save();
            ctx.translate(180, 310);
            for (let i = 0; i < 16; i++) {
                ctx.rotate(Math.PI / 8);
                ctx.strokeRect(-100, -100, 200, 200);
            }
            ctx.restore();
            ctx.fillStyle = card.valid ? '#a7c09c' : '#dfaaa9';
            ctx.beginPath();
            ctx.ellipse(180, 310, 123, 176, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = card.valid ? '#577960' : '#a15f72';
            ctx.beginPath();
            ctx.ellipse(180, 322, 72, 98, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = PAPER;
            ctx.beginPath();
            ctx.arc(156, 279, 22, 0, Math.PI * 2);
            ctx.arc(202, 279, 22, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = INK;
            ctx.beginPath();
            ctx.arc(160, 279, 9, 0, Math.PI * 2);
            ctx.arc(206, 279, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = LIME;
            ctx.beginPath();
            ctx.ellipse(180, 319, 29, 13, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.textAlign = 'left';
            ctx.fillStyle = card.valid ? '#365b4d' : '#8c4b60';
            ctx.font = 'bold 34px sans-serif';
            ctx.fillText(card.valid ? '怪事銀行 / 道具鈔' : '老闆親發 / 非現金票券', 350, 106);
            ctx.font = `900 ${card.label.length > 7 ? 76 : 126}px sans-serif`;
            ctx.fillText(card.label, 350, 310, 615);
            ctx.font = '28px sans-serif';
            ctx.fillText(card.valid ? '遊戲道具，沒有兌換價值' : '注意！不能算進一百萬。', 350, 388);
            ctx.font = '24px monospace';
            ctx.fillText(`ODD JOBS  № ${String(card.id + 1).padStart(4, '0')}`, 350, 505);
            ctx.font = 'bold 26px sans-serif';
            ctx.fillText('自由工坊・離譜日常', 350, 552);
        }, 1024, 640);
        replaceTexture(cashMesh.material as MeshBasicMaterial, t);
    }
    function update(view: StageView) {
        if (disposed)
            return;
        lastView = view;
        const nextId = `${view.game}/${view.game === 'photo' ? view.client : 0}/${view.seed}`;
        if (nextId !== keyId) {
            scene.remove(world);
            world = new Group();
            scene.add(world);
            clientRoot = null;
            board = null;
            birds = [];
            anchors = [];
            stampRoot = null;
            paperMesh = null;
            paperMat = null;
            paperKey = '';
            cashMesh = null;
            cashKey = '';
            tower = null;
            crab = null;
            lamp = null;
            keyId = nextId;
            // Rebuild only on game/client change, never in the render loop.
            if (view.game === 'photo')
                buildPhoto(view);
            else if (view.game === 'stamp')
                buildStamp();
            else
                buildCash();
        }
        if (view.game === 'photo') {
            const pose = photoPose(CLIENTS[view.client].id, view.seconds, view.seed);
            clientRoot!.position.y = pose.lift;
            clientRoot!.rotation.z = view.motion ? pose.sway : 0;
            if (board) {
                board.position.x = pose.boardX;
                board.rotation.z = view.motion ? Math.sin(view.seconds * 4) * .025 : 0;
            }
            birds.forEach((b, i) => { b.visible = pose.birds[i] > 0; b.position.z = .5 + pose.birds[i]; b.rotation.z = view.motion ? Math.sin(view.seconds * 3 + i) * .12 : 0; });
            camera.position.set(view.pan.x, 1.95 + view.pan.y, 6);
            camera.fov = view.fov;
            camera.lookAt(view.pan.x, 1.95 + view.pan.y, 0);
        }
        else {
            camera.position.set(0, 5.3, 2.7);
            camera.fov = view.game === 'stamp' ? 40 : 42;
            camera.lookAt(0, 0, .23);
            if (view.stamp) {
                updatePaper(view.stamp);
                if (stampRoot) {
                    const pulse = 1 - Math.min(1, Math.max(0, view.seconds * 1000 - view.stamp.lastAt) / 180);
                    stampRoot.position.set(view.raised || pulse > 0 || view.stamp.endedAt !== null ? view.stampPoint.x * 1.2 : 1.88, view.raised ? 1.15 : .10 + (1 - Math.max(0, pulse)) * .15, view.raised || pulse > 0 || view.stamp.endedAt !== null ? view.stampPoint.y * 1.5 : 1.20);
                    stampRoot.rotation.z = view.stamp.endedAt !== null ? -.65 : 0;
                }
                tower?.children.forEach((m, i) => { m.visible = i < view.stamp!.index; });
                if (crab) {
                    crab.position.x = 1.98 + (view.motion ? Math.sin(view.seconds * .8) * .12 : 0);
                    crab.rotation.y = view.motion ? Math.sin(view.seconds * 2) * .05 : 0;
                }
                if (lamp)
                    lamp.children[lamp.children.length - 1].visible = view.stamp.endedAt === null;
            }
            if (view.cash) {
                updateCash(view.cash);
                if (cashMesh) {
                    const dt = Math.max(0, view.seconds * 1000 - view.cash.lastAt);
                    cashMesh.position.x = view.motion && view.cash.feedback === 'wrong' ? Math.sin(dt * .045) * Math.exp(-dt / 85) * .18 : 0;
                    cashMesh.position.y = .25 + (view.motion && view.cash.feedback === 'correct' ? Math.exp(-dt / 80) * .12 : 0);
                }
                tower?.children.forEach((m, i) => { m.visible = i < view.cash!.index - view.cash!.rejected; });
            }
        }
        camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
        camera.updateProjectionMatrix();
        scene.updateMatrixWorld(true);
        renderer.render(scene, camera);
        ready = true;
    }
    function resize() { if (disposed)
        return; renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight), false); if (lastView)
        update(lastView); }
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const lost = (event: Event) => { event.preventDefault(); if (!disposed)
        onLost(); };
    renderer.domElement.addEventListener('webglcontextlost', lost);
    return {
        update,
        capture() { if (!ready || disposed)
            throw Error('場景尚未準備好，請稍後再拍。'); renderer.render(scene, camera); const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 720; const ctx = canvas.getContext('2d'); if (!ctx)
            throw Error('圖片無法產生。'); ctx.drawImage(renderer.domElement, 0, 0, 960, 720); return canvas.toDataURL('image/jpeg', .9); },
        framing() { scene.updateMatrixWorld(true); const visible = anchors.filter(a => a.object.visible && a.points.every(p => { const v = a.object.localToWorld(p.clone()).project(camera); return v.z >= -1 && v.z <= 1 && Math.abs(v.x) <= .97 && Math.abs(v.y) <= .97; })).map(a => a.id); return { visible, blocked: !!board && Math.abs(board.position.x) < .85, lift: clientRoot?.position.y ?? 0 }; },
        point(x, y) { const r = host.getBoundingClientRect(); ray.setFromCamera(new Vector2((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1), camera); return ray.ray.intersectPlane(ground, intersection) ? { x: intersection.x / 1.2, y: intersection.z / 1.5 } : null; },
        stats() { return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }; },
        dispose() { if (disposed)
            return; disposed = true; observer.disconnect(); renderer.domElement.removeEventListener('webglcontextlost', lost); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); environment.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); },
    };
}
