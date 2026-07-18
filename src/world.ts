import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TIMELINE, type ExperienceConfig } from './config';

const IMPACT = new THREE.Vector3(-48, 0.35, -151);
const BOMB_RELEASE_POSITION = new THREE.Vector3(-36, 61.4, -152.4);

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number) => {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
};
const smoother = (value: number) => {
  const x = clamp01(value);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const range = (value: number, start: number, end: number) => clamp01((value - start) / (end - start));

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PostShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    shock: { value: 0 },
    exposure: { value: 1 },
    desaturate: { value: 0.16 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float shock;
    uniform float exposure;
    uniform float desaturate;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7)) + time * 31.7) * 43758.5453);
    }

    void main() {
      vec2 centered = vUv - .5;
      float wave = sin(length(centered) * 42.0 - shock * 12.0) * shock * .0035;
      vec2 warped = vUv + normalize(centered + .0001) * wave;
      float chroma = .001 + shock * .008;
      vec3 color;
      color.r = texture2D(tDiffuse, warped + centered * chroma).r;
      color.g = texture2D(tDiffuse, warped).g;
      color.b = texture2D(tDiffuse, warped - centered * chroma).b;
      float luma = dot(color, vec3(.299, .587, .114));
      color = mix(color, vec3(luma), desaturate);
      color *= exposure;
      color += (hash(gl_FragCoord.xy) - .5) * .026;
      float vignette = smoothstep(.9, .18, length(centered * vec2(.92, 1.12)));
      color *= mix(.52, 1.0, vignette);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

type DebrisState = {
  positions: Float32Array;
  velocities: Float32Array;
  geometry: THREE.BufferGeometry;
  points: THREE.Points;
};

type SmokePuff = {
  mesh: THREE.Mesh;
  seed: number;
  stem: boolean;
  baseScale: number;
};

export class CinematicWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(49, 1, 0.08, 500);

  private readonly composer: EffectComposer;
  private readonly postPass: ShaderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly clockTarget = new THREE.Vector3(0, 2.5, -28);
  private readonly config: ExperienceConfig;
  private readonly mobile: boolean;
  private readonly dust: THREE.Points;
  private readonly dustPositions: Float32Array;
  private readonly dustSpeeds: Float32Array;
  private readonly plane: THREE.Group;
  private readonly bomb: THREE.Group;
  private readonly bombTrail: THREE.Points;
  private readonly bombTrailPositions: Float32Array;
  private readonly flashBall: THREE.Mesh;
  private readonly fireball: THREE.Group;
  private readonly shockwave: THREE.Mesh;
  private readonly shockDome: THREE.Mesh;
  private readonly smoke: SmokePuff[] = [];
  private readonly debris: DebrisState;
  private readonly cityBuildings: THREE.Group[] = [];
  private readonly sunLight: THREE.DirectionalLight;
  private exploded = false;
  private optionalAircraft: THREE.Object3D | null = null;

  constructor(canvas: HTMLCanvasElement, config: ExperienceConfig) {
    this.config = config;
    this.mobile = window.matchMedia('(max-width: 760px), (pointer: coarse)').matches;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.mobile ? config.quality.mobilePixelRatio : config.quality.desktopPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = !this.mobile;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.86;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(0x9c8061);
    this.scene.fog = new THREE.FogExp2(0x9a8064, 0.0087);
    this.camera.position.set(0, 2.05, 9.5);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.7, 0.83);
    this.postPass = new ShaderPass(PostShader);
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, this.mobile ? 1 : 1.35));
    this.composer.addPass(renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.postPass);
    this.composer.addPass(new OutputPass());

    const hemi = new THREE.HemisphereLight(0xe4c9a5, 0x4b3827, 1.65);
    this.scene.add(hemi);
    this.sunLight = new THREE.DirectionalLight(0xffd9a4, 2.25);
    this.sunLight.position.set(-26, 42, 16);
    this.sunLight.castShadow = !this.mobile;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.left = -75;
    this.sunLight.shadow.camera.right = 75;
    this.sunLight.shadow.camera.top = 55;
    this.sunLight.shadow.camera.bottom = -55;
    this.scene.add(this.sunLight);

    this.createSky();
    this.createTerrain();
    this.createVillage();
    this.createDistantCity();
    this.dust = this.createDust();
    this.dustPositions = (this.dust.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    this.dustSpeeds = (this.dust.userData.speeds as Float32Array);
    this.plane = this.createAircraft();
    this.bomb = this.createBomb();
    this.bombTrail = this.createBombTrail();
    this.bombTrailPositions = (this.bombTrail.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const explosion = this.createExplosion();
    this.flashBall = explosion.flashBall;
    this.fireball = explosion.fireball;
    this.shockwave = explosion.shockwave;
    this.shockDome = explosion.shockDome;
    this.debris = this.createDebris();

    window.addEventListener('resize', this.resize);
    this.reset();
  }

  async loadOptionalAssets(onProgress?: (progress: number) => void) {
    const aircraftPath = this.config.assets.aircraftGlb;
    if (!aircraftPath) {
      onProgress?.(1);
      return;
    }

    const loader = new GLTFLoader();
    try {
      const gltf = await loader.loadAsync(aircraftPath, (event) => {
        if (event.total > 0) onProgress?.(event.loaded / event.total);
      });
      this.optionalAircraft = gltf.scene;
      this.optionalAircraft.scale.setScalar(1.8);
      this.optionalAircraft.rotation.y = Math.PI / 2;
      this.optionalAircraft.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      this.plane.clear();
      this.plane.add(this.optionalAircraft);
    } catch (error) {
      console.warn('Не удалось загрузить модель самолета, используется встроенная.', error);
    }
    onProgress?.(1);
  }

  reset() {
    this.exploded = false;
    this.camera.position.set(0, 2.05, 9.5);
    this.clockTarget.set(0, 2.5, -28);
    this.camera.lookAt(this.clockTarget);
    this.plane.visible = false;
    this.bomb.visible = false;
    this.bombTrail.visible = false;
    this.fireball.visible = false;
    this.flashBall.visible = false;
    this.shockwave.visible = false;
    this.shockDome.visible = false;
    this.smoke.forEach(({ mesh }) => { mesh.visible = false; });
    this.debris.points.visible = false;
    this.cityBuildings.forEach((building) => {
      building.position.y = building.userData.baseY as number;
      building.rotation.z = 0;
      building.visible = true;
    });
    (this.scene.fog as THREE.FogExp2).density = 0.0087;
    this.scene.background = new THREE.Color(0x9c8061);
    this.sunLight.intensity = 2.25;
    this.renderer.toneMappingExposure = 0.86;
    this.postPass.uniforms.shock.value = 0;
    this.postPass.uniforms.exposure.value = 1;
    this.postPass.uniforms.desaturate.value = 0.16;
    this.bloomPass.strength = 0.32;
    this.camera.fov = 49;
    this.camera.updateProjectionMatrix();
  }

  update(time: number, delta: number) {
    this.updateDust(time, delta);
    this.updateAircraft(time);
    this.updateCamera(time, delta);
    this.updateExplosion(time, delta);
    this.postPass.uniforms.time.value = time;
  }

  render(delta: number) {
    this.composer.render(delta);
  }

  dispose() {
    window.removeEventListener('resize', this.resize);
    this.composer.dispose();
    this.renderer.dispose();
  }

  private readonly resize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
  };

  private createSky() {
    const geometry = new THREE.SphereGeometry(260, 28, 16);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(0x746f69) },
        middle: { value: new THREE.Color(0xb6956e) },
        bottom: { value: new THREE.Color(0x8d7054) },
      },
      vertexShader: `varying vec3 vPos; void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform vec3 top; uniform vec3 middle; uniform vec3 bottom; varying vec3 vPos; void main(){float h=normalize(vPos).y; vec3 c=mix(bottom,middle,smoothstep(-.12,.18,h)); c=mix(c,top,smoothstep(.15,.8,h)); gl_FragColor=vec4(c,1.);}`,
    });
    this.scene.add(new THREE.Mesh(geometry, material));

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(4.2, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd5a0, transparent: true, opacity: 0.3 }),
    );
    sun.position.set(-85, 47, -185);
    this.scene.add(sun);
  }

  private createTerrain() {
    const random = mulberry32(72);
    const geometry = new THREE.PlaneGeometry(420, 370, 72, 72);
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const dune = Math.sin(x * 0.045) * 0.35 + Math.cos(y * 0.035) * 0.45;
      position.setZ(index, dune + (random() - 0.5) * 0.32);
    }
    geometry.computeVertexNormals();
    const terrain = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0x9b7854, roughness: 1, metalness: 0, flatShading: true }),
    );
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.set(0, -0.32, -105);
    terrain.receiveShadow = true;
    this.scene.add(terrain);

    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(17, 150),
      new THREE.MeshStandardMaterial({ color: 0x745c44, roughness: 1, transparent: true, opacity: 0.73 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, -0.04, -51);
    this.scene.add(road);

    const stones = new THREE.Group();
    const stoneGeo = new THREE.DodecahedronGeometry(0.3, 0);
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x67513e, roughness: 1 });
    for (let index = 0; index < 80; index += 1) {
      const stone = new THREE.Mesh(stoneGeo, stoneMat);
      const side = random() > 0.5 ? 1 : -1;
      stone.position.set(side * (5 + random() * 40), random() * 0.25, 8 - random() * 125);
      stone.scale.setScalar(0.25 + random() * 1.4);
      stone.rotation.set(random(), random(), random());
      stones.add(stone);
    }
    this.scene.add(stones);
  }

  private createVillage() {
    const random = mulberry32(404);
    const wallPalette = [0x8c6748, 0x9b7654, 0x76553e, 0xa07b58, 0x6f503c];
    const houseGeometries = new Map<string, THREE.BoxGeometry>();
    const getBox = (w: number, h: number, d: number) => {
      const key = `${w.toFixed(1)}-${h.toFixed(1)}-${d.toFixed(1)}`;
      if (!houseGeometries.has(key)) houseGeometries.set(key, new THREE.BoxGeometry(w, h, d));
      return houseGeometries.get(key)!;
    };

    for (let index = 0; index < 46; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const row = Math.floor(index / 2);
      const z = 2 - row * (4.7 + random() * 1.1);
      const depthBand = Math.floor(row / 5);
      const x = side * (9.8 + depthBand * 1.5 + random() * 11);
      const width = 4.2 + random() * 5.8;
      const height = 2.8 + random() * 4.4;
      const depth = 4 + random() * 6.5;
      const group = new THREE.Group();
      group.position.set(x, height / 2 - 0.12, z);
      group.rotation.y = (random() - 0.5) * 0.15;

      const wall = new THREE.Mesh(
        getBox(width, height, depth),
        new THREE.MeshStandardMaterial({ color: wallPalette[Math.floor(random() * wallPalette.length)], roughness: 1 }),
      );
      wall.castShadow = !this.mobile;
      wall.receiveShadow = true;
      group.add(wall);

      const roof = new THREE.Mesh(
        getBox(width + 0.45, 0.24, depth + 0.45),
        new THREE.MeshStandardMaterial({ color: 0x5d4535, roughness: 1 }),
      );
      roof.position.y = height / 2 + 0.12;
      group.add(roof);

      const facadeZ = depth / 2 + 0.018;
      const dark = new THREE.MeshBasicMaterial({ color: 0x1b1713 });
      const door = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.8), dark);
      door.position.set((random() - 0.5) * width * 0.45, -height / 2 + 0.91, facadeZ);
      group.add(door);

      const windowCount = width > 6.5 ? 2 : 1;
      for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
        const windowMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.62), dark);
        const offset = windowCount === 1 ? 0 : (windowIndex === 0 ? -1 : 1) * width * 0.24;
        windowMesh.position.set(offset, Math.min(height * 0.1, 1.4), facadeZ + 0.003);
        group.add(windowMesh);
      }

      if (random() > 0.6) {
        const parapet = new THREE.Mesh(
          getBox(width + 0.25, 0.45, 0.22),
          new THREE.MeshStandardMaterial({ color: wallPalette[Math.floor(random() * wallPalette.length)], roughness: 1 }),
        );
        parapet.position.set(0, height / 2 + 0.4, depth / 2);
        group.add(parapet);
      }

      if (random() > 0.74) {
        const damage = new THREE.Mesh(
          new THREE.ConeGeometry(0.5 + random() * 0.7, 1.4, 3),
          new THREE.MeshBasicMaterial({ color: 0x34271f }),
        );
        damage.rotation.z = Math.PI;
        damage.position.set((random() - 0.5) * width * 0.65, height / 2 + 0.01, facadeZ + 0.01);
        group.add(damage);
      }

      this.scene.add(group);
    }

    const poles = new THREE.Group();
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x312b25, roughness: 1 });
    for (let z = -4; z > -62; z -= 14) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 5.2, 6), poleMat);
      pole.position.set(-6.9, 2.5, z);
      pole.rotation.z = (random() - 0.5) * 0.03;
      poles.add(pole);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.07), poleMat);
      cross.position.set(-6.9, 4.7, z);
      poles.add(cross);
    }
    this.scene.add(poles);
  }

  private createDistantCity() {
    const random = mulberry32(999);
    const city = new THREE.Group();
    for (let index = 0; index < 31; index += 1) {
      const width = 3 + random() * 6;
      const height = 15 + random() * 38;
      const depth = 4 + random() * 8;
      const building = new THREE.Group();
      building.position.set(-68 + index * 4.5 + (random() - 0.5) * 4, height / 2 - 1, -142 - random() * 26);
      building.userData.baseY = building.position.y;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        new THREE.MeshStandardMaterial({ color: 0x242522, roughness: 0.86, metalness: 0.08 }),
      );
      building.add(mesh);
      if (random() > 0.62) {
        const antenna = new THREE.Mesh(new THREE.BoxGeometry(0.16, 9, 0.16), new THREE.MeshBasicMaterial({ color: 0x171817 }));
        antenna.position.y = height / 2 + 4.5;
        building.add(antenna);
      }
      city.add(building);
      this.cityBuildings.push(building);
    }
    this.scene.add(city);
  }

  private createDust() {
    const count = this.mobile ? this.config.quality.mobileDustParticles : this.config.quality.desktopDustParticles;
    const random = mulberry32(1312);
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const speeds = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (random() - 0.5) * 115;
      positions[index * 3 + 1] = random() * 9;
      positions[index * 3 + 2] = 16 - random() * 135;
      sizes[index] = 0.7 + random() * 2.2;
      speeds[index] = 0.45 + random() * 1.35;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: { color: { value: new THREE.Color(0xc5a57b) } },
      vertexShader: `attribute float size; varying float fade; void main(){vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*(180./-mv.z); fade=clamp(1.-(-mv.z/150.),.15,1.); gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform vec3 color; varying float fade; void main(){float d=length(gl_PointCoord-.5); float a=smoothstep(.5,0.,d)*.34*fade; gl_FragColor=vec4(color,a);}`,
    });
    const points = new THREE.Points(geometry, material);
    points.userData.speeds = speeds;
    this.scene.add(points);
    return points;
  }

  private createAircraft() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x272a2b, roughness: 0.68, metalness: 0.35 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x111313, roughness: 0.8, metalness: 0.2 });
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 1.05, 10.5, 12), bodyMat);
    fuselage.rotation.z = Math.PI / 2;
    group.add(fuselage);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.73, 2.25, 12), bodyMat);
    nose.rotation.z = Math.PI / 2;
    nose.position.x = -6.3;
    group.add(nose);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(1.02, 1.8, 12), bodyMat);
    tail.rotation.z = -Math.PI / 2;
    tail.position.x = 6;
    group.add(tail);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.16, 14.5), bodyMat);
    wing.position.x = 0.5;
    wing.rotation.y = -0.06;
    group.add(wing);
    const rearWing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 5.8), darkMat);
    rearWing.position.x = 5.2;
    group.add(rearWing);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.1, 0.16), darkMat);
    fin.position.set(4.7, 1.15, 0);
    fin.rotation.z = -0.45;
    group.add(fin);
    for (const x of [-0.2, 1.7]) {
      for (const z of [-3.8, 3.8]) {
        const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 2.1, 10), darkMat);
        engine.rotation.z = Math.PI / 2;
        engine.position.set(x, -0.4, z);
        group.add(engine);
      }
    }
    const beacon = new THREE.PointLight(0xb80000, 0, 16, 2);
    beacon.position.set(2.5, 0.6, 0);
    beacon.name = 'beacon';
    group.add(beacon);
    group.scale.setScalar(0.95);
    this.scene.add(group);
    return group;
  }

  private createBomb() {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0x171816, metalness: 0.55, roughness: 0.45 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 2.05, 10), material);
    group.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.7, 10), material);
    nose.position.y = -1.35;
    nose.rotation.z = Math.PI;
    group.add(nose);
    for (let index = 0; index < 4; index += 1) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 0.08), material);
      fin.position.y = 1;
      fin.rotation.y = (Math.PI / 2) * index;
      group.add(fin);
    }
    group.scale.setScalar(2.35);
    this.scene.add(group);
    return group;
  }

  private createBombTrail() {
    const count = this.mobile ? 20 : 36;
    const positions = new Float32Array(count * 3);
    const opacity = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = BOMB_RELEASE_POSITION.x;
      positions[index * 3 + 1] = BOMB_RELEASE_POSITION.y;
      positions[index * 3 + 2] = BOMB_RELEASE_POSITION.z;
      opacity[index] = Math.pow(1 - index / count, 1.35);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('opacity', new THREE.BufferAttribute(opacity, 1));
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { color: { value: new THREE.Color(0xe7c79b) } },
      vertexShader: `attribute float opacity; varying float vOpacity; void main(){vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=(4.+opacity*7.)*(120./-mv.z); vOpacity=opacity; gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform vec3 color; varying float vOpacity; void main(){float d=length(gl_PointCoord-.5); float a=smoothstep(.5,.04,d)*vOpacity*.72; gl_FragColor=vec4(color,a);}`,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.scene.add(points);
    return points;
  }

  private createExplosion() {
    const flashBall = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 18),
      new THREE.MeshBasicMaterial({ color: 0xfff5bf, transparent: true, opacity: 1, blending: THREE.AdditiveBlending }),
    );
    flashBall.position.copy(IMPACT);
    this.scene.add(flashBall);

    const fireball = new THREE.Group();
    fireball.position.copy(IMPACT);
    const hotMaterials = [0xfff2a6, 0xffb21c, 0xff5a09, 0xd42108].map((color, index) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 - index * 0.13, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const random = mulberry32(1945);
    for (let index = 0; index < (this.mobile ? 20 : 38); index += 1) {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75 + random() * 1.2, 1), hotMaterials[index % hotMaterials.length]);
      const radius = Math.pow(random(), 0.72) * 5;
      const angle = random() * Math.PI * 2;
      mesh.position.set(Math.cos(angle) * radius, random() * 4.5, Math.sin(angle) * radius);
      mesh.userData.seed = random();
      fireball.add(mesh);
    }
    this.scene.add(fireball);

    const smokeGeometry = new THREE.IcosahedronGeometry(1, this.mobile ? 1 : 2);
    const smokeMaterials = [0x151718, 0x242424, 0x322d29, 0x40362e].map((color) =>
      new THREE.MeshStandardMaterial({ color, roughness: 1, transparent: true, opacity: 0.83, depthWrite: false }),
    );
    const smokeCount = this.mobile ? 42 : 78;
    for (let index = 0; index < smokeCount; index += 1) {
      const stem = index < Math.floor(smokeCount * 0.35);
      const mesh = new THREE.Mesh(smokeGeometry, smokeMaterials[index % smokeMaterials.length]);
      mesh.visible = false;
      mesh.position.copy(IMPACT);
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      this.smoke.push({ mesh, seed: random(), stem, baseScale: 1.4 + random() * 2.7 });
    }

    const shockwave = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1, 128),
      new THREE.MeshBasicMaterial({ color: 0xffe3ba, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    shockwave.rotation.x = -Math.PI / 2;
    shockwave.position.copy(IMPACT).add(new THREE.Vector3(0, 0.15, 0));
    this.scene.add(shockwave);

    const shockDome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xfff0d2, transparent: true, opacity: 0.09, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: false }),
    );
    shockDome.position.copy(IMPACT);
    this.scene.add(shockDome);
    return { flashBall, fireball, shockwave, shockDome };
  }

  private createDebris(): DebrisState {
    const count = this.mobile ? 260 : 620;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0x241d18, size: this.mobile ? 0.32 : 0.42, transparent: true, opacity: 0.95, sizeAttenuation: true });
    const points = new THREE.Points(geometry, material);
    points.visible = false;
    this.scene.add(points);
    return { positions, velocities, geometry, points };
  }

  private updateDust(time: number, delta: number) {
    const shockBoost = range(time, TIMELINE.shockHit - 0.08, TIMELINE.smokeArrival + 0.6)
      * (1 - range(time, TIMELINE.smokeArrival + 0.65, TIMELINE.finale));
    for (let index = 0; index < this.dustSpeeds.length; index += 1) {
      const offset = index * 3;
      this.dustPositions[offset] += delta * this.dustSpeeds[index] * (1.6 + shockBoost * 19);
      this.dustPositions[offset + 1] += Math.sin(time * 0.7 + index) * delta * 0.06 + shockBoost * delta * 0.7;
      if (this.dustPositions[offset] > 62) this.dustPositions[offset] = -62;
      if (this.dustPositions[offset + 1] > 11) this.dustPositions[offset + 1] = 0.1;
    }
    (this.dust.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    const material = this.dust.material as THREE.ShaderMaterial;
    material.uniforms.color.value.set(shockBoost > 0.2 ? 0x594735 : 0xc5a57b);
  }

  private updateAircraft(time: number) {
    if (time < TIMELINE.planeStart || time > TIMELINE.planeEnd + 0.8) {
      this.plane.visible = false;
    } else {
      this.plane.visible = true;
      const progress = smoother(range(time, TIMELINE.planeStart, TIMELINE.planeEnd));
      this.plane.position.set(78 - progress * 156, 61.5 + Math.sin(progress * Math.PI) * 1.5, -151 - progress * 2);
      this.plane.rotation.set(-0.035, 0.04, -0.018 + Math.sin(time * 0.9) * 0.008);
      const beacon = this.plane.getObjectByName('beacon') as THREE.PointLight | undefined;
      if (beacon) beacon.intensity = Math.sin(time * 11) > 0.84 ? 3.5 : 0;
    }

    if (time >= TIMELINE.bombRelease && time < TIMELINE.impact) {
      const fall = range(time, TIMELINE.bombRelease, TIMELINE.impact);
      this.bomb.visible = true;
      this.getBombPosition(fall, this.bomb.position);
      this.bomb.rotation.z = THREE.MathUtils.lerp(0.24, 0.035, smooth(fall));
      this.bomb.rotation.y = time * 1.65;
      this.bombTrail.visible = true;
      const trailCount = this.bombTrailPositions.length / 3;
      const trailPosition = new THREE.Vector3();
      for (let index = 0; index < trailCount; index += 1) {
        const trailProgress = clamp01(fall - index * 0.013);
        this.getBombPosition(trailProgress, trailPosition);
        this.bombTrailPositions[index * 3] = trailPosition.x;
        this.bombTrailPositions[index * 3 + 1] = trailPosition.y;
        this.bombTrailPositions[index * 3 + 2] = trailPosition.z;
      }
      (this.bombTrail.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    } else {
      this.bomb.visible = false;
      this.bombTrail.visible = false;
    }
  }

  private getBombPosition(progress: number, target: THREE.Vector3) {
    const fall = clamp01(progress);
    const ballistic = Math.pow(fall, 1.72);
    target.set(
      THREE.MathUtils.lerp(BOMB_RELEASE_POSITION.x, IMPACT.x, fall),
      THREE.MathUtils.lerp(BOMB_RELEASE_POSITION.y, IMPACT.y, ballistic),
      THREE.MathUtils.lerp(BOMB_RELEASE_POSITION.z, IMPACT.z, fall) + Math.sin(fall * Math.PI) * 0.8,
    );
    return target;
  }

  private updateCamera(time: number, delta: number) {
    const desired = new THREE.Vector3();
    if (time < 3.25) {
      desired.set(0, 2.5, -30);
    } else if (time < 5.8) {
      const p = smooth(range(time, 3.25, 5.8));
      desired.set(THREE.MathUtils.lerp(0, -24, p), THREE.MathUtils.lerp(2.5, 3.5, p), THREE.MathUtils.lerp(-30, -34, p));
    } else if (time < 8.1) {
      const p = smooth(range(time, 5.8, 8.1));
      desired.set(THREE.MathUtils.lerp(-24, 20, p), THREE.MathUtils.lerp(3.5, 4.2, p), -36);
    } else if (time < TIMELINE.planeStart + 0.6) {
      const p = smooth(range(time, 8.1, TIMELINE.planeStart + 0.6));
      desired.set(THREE.MathUtils.lerp(20, 68, p), THREE.MathUtils.lerp(4.2, 60, p), THREE.MathUtils.lerp(-36, -151, p));
    } else if (time < TIMELINE.bombRelease) {
      desired.copy(this.plane.position);
      desired.x -= 4;
    } else if (time < TIMELINE.impact) {
      desired.copy(this.bomb.position);
      desired.y -= 0.4;
    } else {
      desired.copy(IMPACT).add(new THREE.Vector3(0, 8 + range(time, TIMELINE.impact + 0.12, TIMELINE.finale - 0.45) * 18, 0));
    }

    const focusSpeed = time >= TIMELINE.bombRelease && time < TIMELINE.impact ? 9.5 : (time < 10 ? 1.65 : 3.4);
    const damping = 1 - Math.exp(-delta * focusSpeed);
    this.clockTarget.lerp(desired, damping);

    const explosionShake = time >= TIMELINE.impact
      ? Math.exp(-(time - TIMELINE.impact) * 2.1) * 0.4
      : 0;
    const shockShake = time >= TIMELINE.shockHit
      ? Math.exp(-(time - TIMELINE.shockHit) * 1.8) * range(time, TIMELINE.shockHit, TIMELINE.shockHit + 0.07) * 0.88
      : 0;
    const shake = explosionShake + shockShake;
    this.camera.position.set(
      Math.sin(time * 79) * shake,
      2.05 + Math.cos(time * 93) * shake * 0.62,
      9.5 + Math.sin(time * 67) * shake * 0.32,
    );
    const zoomIn = smooth(range(time, TIMELINE.bombRelease, TIMELINE.bombRelease + 0.38));
    const zoomOut = smooth(range(time, TIMELINE.impact - 0.32, TIMELINE.impact));
    this.camera.fov = 49 - zoomIn * (1 - zoomOut) * 11;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.clockTarget);
    if (shake > 0.01) this.camera.rotateZ(Math.sin(time * 58) * shake * 0.018);
  }

  private updateExplosion(time: number, delta: number) {
    if (time < TIMELINE.impact) return;
    const elapsed = time - TIMELINE.impact;
    if (!this.exploded) this.triggerExplosion();

    const flash = 1 - smooth(range(elapsed, 0.04, 0.72));
    this.flashBall.visible = flash > 0.001;
    this.flashBall.scale.setScalar(1 + smoother(range(elapsed, 0, 0.58)) * 34);
    (this.flashBall.material as THREE.MeshBasicMaterial).opacity = flash;

    const fireGrowth = smoother(range(elapsed, 0.02, 1.08));
    const fireFade = 1 - smooth(range(elapsed, 0.78, 3.18));
    this.fireball.visible = fireFade > 0.01;
    this.fireball.scale.setScalar(0.2 + fireGrowth * 3.65);
    this.fireball.position.y = IMPACT.y + smooth(range(elapsed, 0.28, 2.45)) * 7;
    this.fireball.children.forEach((child, index) => {
      const mesh = child as THREE.Mesh;
      mesh.rotation.x += delta * (0.15 + (index % 5) * 0.025);
      mesh.rotation.y -= delta * (0.12 + (index % 3) * 0.035);
      (mesh.material as THREE.MeshBasicMaterial).opacity = fireFade * (0.65 + (mesh.userData.seed as number) * 0.3);
    });

    const wave = smoother(range(elapsed, 0.05, 1.72));
    this.shockwave.visible = wave < 0.999;
    this.shockwave.scale.setScalar(1 + wave * 190);
    (this.shockwave.material as THREE.MeshBasicMaterial).opacity = (1 - wave) * 0.67;
    this.shockDome.visible = wave < 0.98;
    this.shockDome.scale.set(1 + wave * 178, 1 + wave * 72, 1 + wave * 178);
    (this.shockDome.material as THREE.MeshBasicMaterial).opacity = (1 - wave) * 0.13;

    this.updateSmoke(elapsed);
    this.updateDebris(elapsed, delta);

    const shockFx = Math.exp(-Math.pow((time - TIMELINE.shockHit) * 2.8, 2));
    this.postPass.uniforms.shock.value = shockFx;
    this.postPass.uniforms.exposure.value = 1 + flash * 2.8 + shockFx * 0.3;
    this.postPass.uniforms.desaturate.value = 0.16 + range(time, TIMELINE.smokeArrival, TIMELINE.finale) * 0.6;
    this.bloomPass.strength = 0.32 + flash * 1.7;
    this.renderer.toneMappingExposure = 0.86 + flash * 1.3;
    (this.scene.fog as THREE.FogExp2).density = 0.0087 + smooth(range(time, TIMELINE.dustArrival, TIMELINE.finale - 0.1)) * 0.043;
    this.sunLight.intensity = 2.25 + flash * 8 - smooth(range(time, TIMELINE.smokeArrival, TIMELINE.finale - 0.1)) * 1.75;
  }

  private triggerExplosion() {
    this.exploded = true;
    this.fireball.visible = true;
    this.flashBall.visible = true;
    this.shockwave.visible = true;
    this.shockDome.visible = true;
    this.debris.points.visible = true;
    const random = mulberry32(4242);
    for (let index = 0; index < this.debris.velocities.length / 3; index += 1) {
      const offset = index * 3;
      const angle = random() * Math.PI * 2;
      const speed = 5 + random() * 24;
      this.debris.positions[offset] = IMPACT.x + (random() - 0.5) * 4;
      this.debris.positions[offset + 1] = IMPACT.y + random() * 2;
      this.debris.positions[offset + 2] = IMPACT.z + (random() - 0.5) * 4;
      this.debris.velocities[offset] = Math.cos(angle) * speed;
      this.debris.velocities[offset + 1] = 5 + random() * 23;
      this.debris.velocities[offset + 2] = Math.sin(angle) * speed;
    }
    this.cityBuildings.forEach((building, index) => {
      const distance = Math.abs(building.position.x - IMPACT.x);
      if (distance < 55) {
        building.rotation.z = (building.position.x < IMPACT.x ? -1 : 1) * (0.08 + (index % 3) * 0.025);
        building.position.y -= 2 + (index % 4) * 1.2;
      }
    });
  }

  private updateSmoke(elapsed: number) {
    this.smoke.forEach((puff, index) => {
      const delay = puff.stem ? (index % 9) * 0.045 : 0.45 + (index % 13) * 0.035;
      const age = Math.max(0, elapsed - delay);
      if (age <= 0) return;
      puff.mesh.visible = true;
      const seedAngle = puff.seed * Math.PI * 2;
      if (puff.stem) {
        const layer = index % 16;
        const radial = 1.2 + (index % 5) * 0.46;
        puff.mesh.position.set(
          IMPACT.x + Math.cos(seedAngle) * radial,
          IMPACT.y + Math.min(25, age * (5.2 + layer * 0.1)) + layer * 0.34,
          IMPACT.z + Math.sin(seedAngle) * radial,
        );
      } else {
        const capIndex = index - Math.floor(this.smoke.length * 0.35);
        const ring = Math.sqrt((capIndex % 34) / 34) * (7 + age * 3.8);
        puff.mesh.position.set(
          IMPACT.x + Math.cos(seedAngle) * ring,
          IMPACT.y + Math.min(29, age * 6.1) + Math.sin(seedAngle * 2.4) * 2.2,
          IMPACT.z + Math.sin(seedAngle) * ring,
        );
      }
      const growth = smooth(range(age, 0, 2.2));
      const scale = puff.baseScale * (0.3 + growth * (puff.stem ? 1.35 : 2.15));
      puff.mesh.scale.setScalar(scale);
      puff.mesh.rotation.set(seedAngle * 0.3 + age * 0.04, age * (0.04 + puff.seed * 0.05), seedAngle);
      (puff.mesh.material as THREE.MeshStandardMaterial).opacity = Math.min(0.87, age * 0.55) * (1 - range(elapsed, 7.2, 10));
    });
  }

  private updateDebris(elapsed: number, delta: number) {
    if (elapsed > 6) {
      this.debris.points.visible = false;
      return;
    }
    const drag = Math.pow(0.985, delta * 60);
    for (let index = 0; index < this.debris.velocities.length / 3; index += 1) {
      const offset = index * 3;
      this.debris.velocities[offset] *= drag;
      this.debris.velocities[offset + 1] -= 12 * delta;
      this.debris.velocities[offset + 2] *= drag;
      this.debris.positions[offset] += this.debris.velocities[offset] * delta;
      this.debris.positions[offset + 1] += this.debris.velocities[offset + 1] * delta;
      this.debris.positions[offset + 2] += this.debris.velocities[offset + 2] * delta;
      if (this.debris.positions[offset + 1] < 0) {
        this.debris.positions[offset + 1] = 0;
        this.debris.velocities[offset + 1] *= -0.18;
      }
    }
    this.debris.geometry.attributes.position.needsUpdate = true;
    (this.debris.points.material as THREE.PointsMaterial).opacity = 1 - range(elapsed, 3.2, 6);
  }
}
