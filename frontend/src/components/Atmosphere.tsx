import { Component, Suspense, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useReducedMotion } from "framer-motion";
import * as THREE from "three";

class CanvasBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
function Lattice({ quiet }: { quiet: boolean }) {
  const group = useRef<THREE.Group>(null);
  const points = useMemo(() => {
    const array: number[] = [];
    for (let i = 0; i < 180; i++) {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / 180),
        theta = Math.PI * (1 + Math.sqrt(5)) * i;
      array.push(
        3.1 * Math.cos(theta) * Math.sin(phi),
        3.1 * Math.sin(theta) * Math.sin(phi),
        3.1 * Math.cos(phi),
      );
    }
    return new Float32Array(array);
  }, []);
  useFrame(({ clock }) => {
    if (group.current && !quiet) {
      group.current.rotation.y = clock.elapsedTime * 0.055;
      group.current.rotation.z =
        0.25 + Math.sin(clock.elapsedTime * 0.08) * 0.05;
    }
  });
  return (
    <group ref={group} rotation={[0.4, 0.1, 0.3]}>
      <mesh>
        <icosahedronGeometry args={[2.75, 1]} />
        <meshBasicMaterial
          color="#f42549"
          wireframe
          transparent
          opacity={0.18}
        />
      </mesh>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[points, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color="#ff778b"
          size={0.035}
          transparent
          opacity={0.7}
        />
      </points>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[3.45, 0.008, 8, 120]} />
        <meshBasicMaterial color="#f42549" transparent opacity={0.2} />
      </mesh>
      <mesh rotation={[0.3, 0.7, 0.8]}>
        <torusGeometry args={[3.65, 0.006, 8, 120]} />
        <meshBasicMaterial color="#be314b" transparent opacity={0.13} />
      </mesh>
    </group>
  );
}
export default function Atmosphere({ compact = false }: { compact?: boolean }) {
  const reduced = useReducedMotion();
  return (
    <div
      className={`atmosphere ${compact ? "compact" : ""}`}
      aria-hidden="true"
    >
      <CanvasBoundary>
        <Suspense fallback={null}>
          <Canvas
            camera={{ position: [0, 0, 9], fov: 46 }}
            dpr={[1, 1.5]}
            frameloop={reduced ? "demand" : "always"}
            gl={{ alpha: true, antialias: false, powerPreference: "low-power" }}
          >
            <Lattice quiet={!!reduced} />
          </Canvas>
        </Suspense>
      </CanvasBoundary>
    </div>
  );
}
