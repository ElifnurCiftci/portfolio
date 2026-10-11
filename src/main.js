import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

let scene, camera, renderer, controls, clock;
let starPoints;                 // THREE.Points
let starTexture;                // yıldız dokusu
let attractorPoints = [];
let isAttractorMode = false;

const PARTICLE_COUNT = 10000;
const BOUND = 50;               // küp yarı-genişliği (±50)
const SIZE = BOUND * 2;

// Hareket ayarları (hepsi "saniye" bazlı, FPS'ten bağımsız)
const DRIFT_DIRECTION = new THREE.Vector3(-1, -0.35, 0).normalize(); // kayma yönü
const MIN_SPEED = 1.5;          // en yavaş yıldız (birim/sn)
const MAX_SPEED = 7;            // en hızlı yıldız
const VELOCITY_EASING = 1.5;    // hız değişimi ne kadar yumuşak (küçük = daha yumuşak)
const ATTRACTOR_EASING = 2.5;   // çekiciye gidiş yumuşaklığı

// Yıldız görünümü ayarları
const STAR_MIN_SIZE = 0.22;     // en küçük (sıradan) yıldızların boyutu
const STAR_BIG_BOOST = 2.2;     // nadir parlak yıldızlara eklenen ekstra boyut
const STAR_MAX_PIXELS = 26;     // ekranda bir yıldızın alabileceği en büyük boyut (px)

const sigma = 10, rho = 28, beta = 8 / 3;
const dt = 0.01;
const numSteps = 5000;

let isDarkMode = true;

// Her partikül için ayrı veriler
const velocities = new Float32Array(PARTICLE_COUNT * 3);     // anlık hız
const baseVelocities = new Float32Array(PARTICLE_COUNT * 3); // ulaşmak istediği hız
const wobblePhase = new Float32Array(PARTICLE_COUNT);
const wobbleFreq = new Float32Array(PARTICLE_COUNT);

const modeToggle = document.getElementById("mode-toggle");
const modeIndicator = document.getElementById("mode-indicator");

function updateIndicator() {
  if (isDarkMode) modeIndicator.classList.add("active");
  else modeIndicator.classList.remove("active");
}

// NOT: Eskiden toggleTheme iki kez bağlanmıştı (iki tık = hiç değişmiyordu).
// Artık her eleman için sadece bir kez bağlıyoruz.
modeToggle.addEventListener("click", toggleTheme);
modeIndicator.addEventListener("click", toggleTheme);

// Arayüz elemanlarına tıklayınca çekici modu tetiklenmesin
document.addEventListener('click', (e) => {
  if (e.target.closest('#menu, #mode-toggle, #mode-indicator, .section')) return;
  toggleMode();
});

function showSection(sectionId) {
  document.querySelectorAll(".section").forEach(section => {
    section.style.display = "none";
  });
  const selectedSection = document.getElementById(sectionId);
  if (selectedSection) selectedSection.style.display = "block";
}

document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll("#menu button").forEach(button => {
    button.addEventListener("click", function () {
      const sectionId = this.dataset.section;
      if (sectionId) showSection(sectionId);
      else console.error("Button missing data-section attribute!");
    });
  });
});

init();
animate();

/* ------------------------------------------------------------------ */
/*  YILDIZ DOKUSU                                                      */
/* ------------------------------------------------------------------ */
// Canvas ile çizilen, yuvarlak ve kenarları yumuşak parlayan nokta.
// Beyaz çiziyoruz; rengi PointsMaterial.color belirliyor (koyu/açık mod).
function createStarTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const mid = size / 2;

  ctx.globalCompositeOperation = 'lighter';

  // 1) Küçük, parlak yuvarlak çekirdek + hafif hale
  const core = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid * 0.45);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.15, 'rgba(255,255,255,0.85)');
  core.addColorStop(0.45, 'rgba(255,255,255,0.15)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(mid, mid, mid * 0.45, 0, Math.PI * 2);
  ctx.fill();

  // 2) Çok ince, uçlara doğru sönen ışık çizgileri (yatay + dikey)
  const h = ctx.createLinearGradient(0, 0, size, 0);
  h.addColorStop(0, 'rgba(255,255,255,0)');
  h.addColorStop(0.5, 'rgba(255,255,255,0.75)');
  h.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = h;
  ctx.fillRect(0, mid - 0.75, size, 1.5);

  const v = ctx.createLinearGradient(0, 0, 0, size);
  v.addColorStop(0, 'rgba(255,255,255,0)');
  v.addColorStop(0.5, 'rgba(255,255,255,0.75)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = v;
  ctx.fillRect(mid - 0.75, 0, 1.5, size);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------ */
/*  SAHNE                                                              */
/* ------------------------------------------------------------------ */
function init() {
  scene = new THREE.Scene();
  clock = new THREE.Clock();

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, 50);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;     // kamera hareketi de yumuşak olsun
  controls.dampingFactor = 0.05;

  starTexture = createStarTexture();
  generateStars();
  generateLorenzAttractor();

  window.addEventListener('resize', onWindowResize);
  updateIndicator();
  setTheme(isDarkMode);
}

function generateStars() {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    positions[i * 3]     = (Math.random() - 0.5) * SIZE;
    positions[i * 3 + 1] = (Math.random() - 0.5) * SIZE;
    positions[i * 3 + 2] = (Math.random() - 0.5) * SIZE;

    // Her yıldızın hızı farklı -> paralaks / derinlik hissi
    const speed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
    // Yönde hafif sapma: hepsi aynı çizgide gitmesin
    const bx = DRIFT_DIRECTION.x + (Math.random() - 0.5) * 0.25;
    const by = DRIFT_DIRECTION.y + (Math.random() - 0.5) * 0.25;
    const bz = (Math.random() - 0.5) * 0.15;

    baseVelocities[i * 3]     = bx * speed;
    baseVelocities[i * 3 + 1] = by * speed;
    baseVelocities[i * 3 + 2] = bz * speed;

    // Başlangıçta zaten kayıyor olsunlar
    velocities[i * 3]     = baseVelocities[i * 3];
    velocities[i * 3 + 1] = baseVelocities[i * 3 + 1];
    velocities[i * 3 + 2] = baseVelocities[i * 3 + 2];

    wobblePhase[i] = Math.random() * Math.PI * 2;
    wobbleFreq[i] = 0.2 + Math.random() * 0.5;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  // --- Her yıldıza ayrı boyut, renk ve titreşim fazı ---
  const sizes = new Float32Array(PARTICLE_COUNT);
  const phases = new Float32Array(PARTICLE_COUNT);
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const palette = [
    [1.0, 1.0, 1.0],    // beyaz
    [0.72, 0.82, 1.0],  // soğuk mavi
    [1.0, 0.92, 0.75],  // sıcak sarımsı
  ];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Çoğu yıldız çok küçük, çok azı belirgin parlak (pow ile)
    sizes[i] = STAR_MIN_SIZE + Math.pow(Math.random(), 5) * STAR_BIG_BOOST;
    phases[i] = Math.random();
    const c = palette[Math.random() < 0.6 ? 0 : (Math.random() < 0.5 ? 1 : 2)];
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
  }
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: starTexture },
      uTime: { value: 0 },
      uScale: { value: renderer.getPixelRatio() * window.innerHeight * 0.5 },
      uDarkMode: { value: 1 },
      uOpacity: { value: 0.9 },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aPhase;
      attribute vec3 aColor;
      uniform float uTime;
      uniform float uScale;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // Boyut kameraya uzaklığa göre küçülür, çok yaklaşanlar devasa olmasın diye sınırlı
        gl_PointSize = min(aSize * uScale / max(-mv.z, 0.1), ${STAR_MAX_PIXELS.toFixed(1)});
        // Yavaş, yıldız gibi titreşim (her yıldızın hızı/fazı farklı)
        float tw = sin(uTime * (0.6 + aPhase * 1.8) + aPhase * 6.2831);
        vAlpha = 0.72 + 0.28 * tw;
        vColor = aColor;
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform float uDarkMode;
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        // Açık modda yıldızlar koyu renk olur
        vec3 col = uDarkMode > 0.5 ? vColor : vec3(0.07);
        gl_FragColor = vec4(col, tex.a * vAlpha * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  starPoints = new THREE.Points(geometry, material);
  scene.add(starPoints);
}

function generateLorenzAttractor() {
  const xyz = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < numSteps; i++) {
    const dx = sigma * (xyz.y - xyz.x) * dt;
    const dy = (xyz.x * (rho - xyz.z) - xyz.y) * dt;
    const dz = (xyz.x * xyz.y - beta * xyz.z) * dt;
    xyz.add(new THREE.Vector3(dx, dy, dz));
    attractorPoints.push(xyz.clone());
  }
}

/* ------------------------------------------------------------------ */
/*  ANİMASYON                                                          */
/* ------------------------------------------------------------------ */
function animate() {
  requestAnimationFrame(animate);

  // Sekme arka plandayken büyük dt gelirse sıçrama olmasın
  const delta = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  starPoints.material.uniforms.uTime.value = time;

  const positions = starPoints.geometry.attributes.position.array;
  const count = PARTICLE_COUNT;

  if (isAttractorMode) {
    // Frame-rate bağımsız, yumuşak yaklaşma
    const k = 1 - Math.exp(-ATTRACTOR_EASING * delta);
    for (let i = 0; i < count; i++) {
      const p = attractorPoints[i % attractorPoints.length];
      const ix = i * 3;
      positions[ix]     += (p.x - positions[ix]) * k;
      positions[ix + 1] += (p.y - positions[ix + 1]) * k;
      positions[ix + 2] += (p.z - positions[ix + 2]) * k;
    }
  } else {
    // Hız, hedef hıza yavaşça yaklaşır -> çekiciden çıkarken ani sıçrama olmaz
    const ease = 1 - Math.exp(-VELOCITY_EASING * delta);
    for (let i = 0; i < count; i++) {
      const ix = i * 3;

      velocities[ix]     += (baseVelocities[ix]     - velocities[ix])     * ease;
      velocities[ix + 1] += (baseVelocities[ix + 1] - velocities[ix + 1]) * ease;
      velocities[ix + 2] += (baseVelocities[ix + 2] - velocities[ix + 2]) * ease;

      // Hafif dalgalanma: düz çizgi yerine süzülen bir eğri
      const wobble = Math.sin(time * wobbleFreq[i] + wobblePhase[i]) * 0.8;

      positions[ix]     += velocities[ix] * delta;
      positions[ix + 1] += (velocities[ix + 1] + wobble) * delta;
      positions[ix + 2] += velocities[ix + 2] * delta;

      // Sınırdan çıkan yıldız ters dönmez, diğer taraftan geri girer (kesintisiz akış)
      if (positions[ix]     < -BOUND) positions[ix]     += SIZE;
      else if (positions[ix]     > BOUND) positions[ix]     -= SIZE;
      if (positions[ix + 1] < -BOUND) positions[ix + 1] += SIZE;
      else if (positions[ix + 1] > BOUND) positions[ix + 1] -= SIZE;
      if (positions[ix + 2] < -BOUND) positions[ix + 2] += SIZE;
      else if (positions[ix + 2] > BOUND) positions[ix + 2] -= SIZE;
    }
  }

  starPoints.geometry.attributes.position.needsUpdate = true;
  controls.update();
  renderer.render(scene, camera);
}

function toggleMode() {
  isAttractorMode = !isAttractorMode;
  // Çekiciden çıkarken özel bir şey yapmaya gerek yok:
  // hızlar zaten yumuşakça tekrar kayma hızına dönüyor.
}

/* ------------------------------------------------------------------ */
/*  TEMA                                                               */
/* ------------------------------------------------------------------ */
function toggleTheme() {
  isDarkMode = !isDarkMode;
  setTheme(isDarkMode);
  updateIndicator();
}

function setTheme(dark) {
  renderer.setClearColor(dark ? 0x000000 : 0xffffff);

  const mat = starPoints.material;
  mat.uniforms.uDarkMode.value = dark ? 1 : 0;
  // Koyu zeminde parlayan (additive), açık zeminde normal karışım:
  // additive blending beyaz arka planda görünmez olurdu.
  mat.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
  mat.uniforms.uOpacity.value = dark ? 0.9 : 0.85;
  mat.needsUpdate = true;
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  starPoints.material.uniforms.uScale.value = renderer.getPixelRatio() * window.innerHeight * 0.5;
}