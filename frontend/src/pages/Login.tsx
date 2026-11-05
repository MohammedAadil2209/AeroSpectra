import { useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sparkles, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/layout/AppLayout';
import { DEMO_USERS, getSession, login } from '@/utils/auth';

const NAVY = new THREE.Color('#1d4a66');
const STEEL = new THREE.Color('#9fc0d6');
const CRIMSON = new THREE.Color('#e5383b');

/** Flowing wave of particles (steel blue -> crimson at the crests). */
function ParticleWave() {
  const COLS = 160, ROWS = 70, GAP = 0.32;
  const geo = useMemo(() => {
    const pos = new Float32Array(COLS * ROWS * 3);
    const col = new Float32Array(COLS * ROWS * 3);
    for (let i = 0; i < COLS; i++)
      for (let j = 0; j < ROWS; j++) {
        const k = (i * ROWS + j) * 3;
        pos[k] = (i - COLS / 2) * GAP;
        pos[k + 2] = (j - ROWS / 2) * GAP;
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  const tmp = useMemo(() => new THREE.Color(), []);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 0.6;
    const pos = geo.attributes.position.array as Float32Array;
    const col = geo.attributes.color.array as Float32Array;
    for (let i = 0; i < COLS; i++)
      for (let j = 0; j < ROWS; j++) {
        const k = (i * ROWS + j) * 3;
        const y = Math.sin(i * 0.12 + t) * 0.7 + Math.cos(j * 0.18 + t * 0.8) * 0.5 + Math.sin((i + j) * 0.05 + t * 0.5) * 0.4;
        pos[k + 1] = y;
        const h = (y + 1.6) / 3.2;
        tmp.copy(NAVY).lerp(STEEL, Math.min(1, h * 1.4));
        if (h > 0.72) tmp.lerp(CRIMSON, (h - 0.72) / 0.28);
        col[k] = tmp.r; col[k + 1] = tmp.g; col[k + 2] = tmp.b;
      }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  });
  return (
    <points geometry={geo} position={[0, -3.2, -8]} rotation={[0.12, 0, 0]}>
      <pointsMaterial size={0.06} vertexColors transparent opacity={0.9} sizeAttenuation depthWrite={false} toneMapped={false} />
    </points>
  );
}

/** Slowly rotating ring of particles, like an orbit track. */
function ParticleOrbit() {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const N = 2600;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let n = 0; n < N; n++) {
      const a = Math.random() * Math.PI * 2;
      const r = 7 + (Math.random() - 0.5) * 2.2 * Math.random();
      pos[n * 3] = Math.cos(a) * r;
      pos[n * 3 + 1] = (Math.random() - 0.5) * 0.5;
      pos[n * 3 + 2] = Math.sin(a) * r;
      const c = Math.random() < 0.18 ? CRIMSON : STEEL;
      col[n * 3] = c.r; col[n * 3 + 1] = c.g; col[n * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.05;
  });
  return (
    <points ref={ref} geometry={geo} position={[-3, 2.2, -14]} rotation={[0.35, 0, 0.18]}>
      <pointsMaterial size={0.05} vertexColors transparent opacity={0.75} depthWrite={false} toneMapped={false} />
    </points>
  );
}

function Scene() {
  return (
    <Canvas camera={{ position: [0, 1.5, 9], fov: 55 }} dpr={[1, 1.5]} gl={{ antialias: true }}>
      <color attach="background" args={['#050f17']} />
      <fog attach="fog" args={['#050f17', 10, 34]} />
      <Stars radius={80} depth={40} count={3500} factor={3} fade speed={0.5} />
      <Sparkles count={120} scale={[24, 10, 12]} size={2.2} speed={0.25} color="#9fc0d6" opacity={0.55} />
      <ParticleOrbit />
      <ParticleWave />
    </Canvas>
  );
}

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (getSession()) return <Navigate to="/" replace />;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true);
    setTimeout(() => {
      const s = login(email, password, remember);
      setBusy(false);
      if (!s) return setError('Invalid email or password.');
      nav(loc.state?.from ?? '/', { replace: true });
    }, 450);
  };
  const demo = Object.entries(DEMO_USERS)[0];

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#050f17] text-[#fcf4db]">
      <div className="absolute inset-0"><Scene /></div>
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 30% 50%, rgba(5,15,23,0) 30%, rgba(5,15,23,.85) 100%)' }} />

      <div className="relative z-10 h-full grid lg:grid-cols-[1fr_460px] items-center gap-8 px-6 md:px-12">
        <div className="hidden lg:block max-w-xl">
          <div className="text-[11px] uppercase tracking-[0.3em] text-[#9fc0d6]">AeroSpectra · AI aircraft inspection</div>
          <h1 className="font-display text-5xl leading-tight mt-3">Detect. Visualize.<br /><span className="text-[#e5383b]">Document.</span></h1>
          <p className="mt-4 text-[#c9d6df] text-[15px] leading-relaxed">
            Drone-assisted visual inspection with real-time AI detection of cracks, dents and corrosion, advisory risk scoring and full maintenance traceability.
          </p>
          <div className="mt-6 flex gap-6 text-sm text-[#9fc0d6]">
            <span>● Live AI on GPU</span><span>● Human-in-the-loop</span><span>● Audit trail</span>
          </div>
        </div>

        <form onSubmit={submit} className="w-full max-w-[440px] mx-auto rounded-2xl border border-white/10 bg-[#092635]/70 backdrop-blur-xl p-8 shadow-[0_20px_80px_rgba(0,0,0,.5)]">
          <div className="theme-dark [&_.text-ink]:!text-[#fcf4db]"><Logo /></div>
          <h2 className="font-display text-2xl mt-6">Sign in</h2>
          <p className="text-sm text-[#9fc0d6] mt-1">Access the inspection console</p>

          <label className="block mt-6 text-xs font-semibold text-[#c9d6df]" htmlFor="email">Email</label>
          <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-white/15 bg-black/25 px-3 focus-within:border-[#e5383b]">
            <Mail className="size-4 text-[#9fc0d6]" />
            <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
              className="h-11 flex-1 bg-transparent outline-none text-sm placeholder:text-white/30" placeholder="you@company.com" />
          </div>

          <label className="block mt-4 text-xs font-semibold text-[#c9d6df]" htmlFor="pw">Password</label>
          <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-white/15 bg-black/25 px-3 focus-within:border-[#e5383b]">
            <Lock className="size-4 text-[#9fc0d6]" />
            <input id="pw" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="h-11 flex-1 bg-transparent outline-none text-sm placeholder:text-white/30" placeholder="••••••••" />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="text-[#9fc0d6] hover:text-white">
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between text-xs">
            <label className="flex items-center gap-2 cursor-pointer text-[#c9d6df]">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-[#7d0a0a]" /> Remember me
            </label>
            <span className="text-[#9fc0d6]">Secure session</span>
          </div>

          {error && <div className="mt-4 rounded-lg border border-[#e5383b]/50 bg-[#e5383b]/15 px-3 py-2 text-sm text-[#ffb3b5]" role="alert">{error}</div>}

          <button type="submit" disabled={busy}
            className="mt-6 h-11 w-full rounded-lg bg-[#7d0a0a] hover:bg-[#9b1111] font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-70">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Sign in
          </button>

          <button type="button" onClick={() => { setEmail(demo[0]); setPassword(demo[1].password); }}
            className="mt-3 w-full text-xs text-[#9fc0d6] hover:text-white">
            Use demo account ({demo[0]} / {demo[1].password})
          </button>
        </form>
      </div>
    </div>
  );
}
