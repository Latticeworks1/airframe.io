/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { DEFAULT_AIRCRAFT, AIRCRAFT_DEFINITIONS } from "../game/aircraftData";
import { createAircraftMesh } from "../game/content/aircraft/aircraftBuilder";
import { MAP_REGISTRY } from "../game/content/maps/registry";
import { KnownMaps, getAtmosphereSunDirection } from "../game/content/maps/mapTypes";

interface PlanePreview3DProps {
  planeId: string;
  fullScreen?: boolean;
  skinId?: string;
  mapId?: string;
}

export function PlanePreview3D({
  planeId,
  fullScreen = false,
  skinId = "default",
  mapId = KnownMaps.IslandChain
}: PlanePreview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || 300;
    const height = container.clientHeight || 200;

    // 1. Scene setup
    const scene = new THREE.Scene();

    const mapDef = MAP_REGISTRY[mapId] ?? MAP_REGISTRY[KnownMaps.IslandChain];
    const atmosphere = mapDef.atmosphere;

    scene.background = new THREE.Color(atmosphere.preview.backgroundColor);

    if (fullScreen) {
      scene.fog = new THREE.Fog(
        atmosphere.fogColor,
        atmosphere.preview.fogNear,
        atmosphere.preview.fogFar
      );
    } else {
      scene.fog = new THREE.Fog(
        atmosphere.fogColor,
        atmosphere.preview.fogNear * 0.65,
        atmosphere.preview.fogFar * 0.62
      );
    }

    // 2. Camera setup
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    // Position camera dynamic based on fullscreen state
    if (fullScreen) {
      camera.position.set(16, 8, 22);
    } else {
      camera.position.set(13, 7, 18);
    }
    camera.lookAt(0, 0, 0);

    // 3. Renderer setup
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false, // Opaque matching the thematic operations biome
      powerPreference: "high-performance"
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    // Preview lighting uses the same sun and sky colors as the flight renderer.
    const ambientLight = new THREE.HemisphereLight(
      atmosphere.skyLightColor,
      atmosphere.groundLightColor,
      atmosphere.ambientIntensity * 0.72
    );
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(
      atmosphere.sunColor,
      atmosphere.sunIntensity
    );
    dirLight1.position
      .copy(getAtmosphereSunDirection(atmosphere))
      .multiplyScalar(45);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(
      atmosphere.preview.fillLightColor,
      atmosphere.preview.fillLightIntensity
    );
    dirLight2.position.set(-20, -10, -15);
    scene.add(dirLight2);

    // Find SPEC details for active aircraft
    const spec = DEFAULT_AIRCRAFT.find((a) => a.id === planeId) || DEFAULT_AIRCRAFT[0];
    let colorHex = spec.color;
    let secHex = spec.secondaryColor;
    let accentHex = spec.accentColor;

    if (skinId === "camo") {
      colorHex = "#2d5a27"; // RFC Green Camo
      secHex = "#5c4033";   // Dark Earth Brown
      accentHex = "#22c55e"; // Bright green accent
    } else if (skinId === "crimson") {
      colorHex = "#991b1b"; // Deep Crimson red
      secHex = "#1e293b";   // Charcoal fuselage decals
      accentHex = "#f97316"; // Hot orange
    } else if (skinId === "carbon") {
      colorHex = "#0f172a"; // Gloss Dark carbon black
      secHex = "#334155";   // Modern industrial grey
      accentHex = "#38bdf8"; // Cyan tracer-style LED
    } else if (skinId === "gold") {
      colorHex = "#eab308"; // Burnished yellow-gold
      secHex = "#ca8a04";   // Deeper secondary gold gradient
      accentHex = "#ffffff"; // Diamond-white exhaust glow
    }

    // 5. Build Aircraft structure from unified content specs representation
    const def = AIRCRAFT_DEFINITIONS.find((a) => a.specs.id === planeId);
    if (!def) return;

    const renderDef = {
      ...def.render,
      materials: {
        ...def.render.materials,
        primary: colorHex || def.render.materials.primary,
        secondary: secHex || def.render.materials.secondary,
        accent: accentHex || def.render.materials.accent
      }
    };

    const group = createAircraftMesh(renderDef);

    // Centering alignment pivot
    const pivot = new THREE.Group();
    pivot.add(group);
    pivot.position.set(0, -0.2, 0); // slightly balance vertical centroid
    scene.add(pivot);

    // Build regional procedural background environment structures
    const envGroup = new THREE.Group();
    scene.add(envGroup);

    // Dynamic environmental skybox sphere with canvas texture gradient
    const skyGeo = new THREE.SphereGeometry(65, 32, 24);
    const skyCanvas = document.createElement("canvas");
    skyCanvas.width = 128;
    skyCanvas.height = 256;
    const skyCtx = skyCanvas.getContext("2d");
    if (skyCtx) {
      const gradient = skyCtx.createLinearGradient(0, 0, 0, skyCanvas.height);
      gradient.addColorStop(
        0,
        new THREE.Color(atmosphere.preview.skyGradient[0]).getStyle()
      );
      gradient.addColorStop(
        0.5,
        new THREE.Color(atmosphere.preview.skyGradient[1]).getStyle()
      );
      gradient.addColorStop(
        1,
        new THREE.Color(atmosphere.preview.skyGradient[2]).getStyle()
      );
      skyCtx.fillStyle = gradient;
      skyCtx.fillRect(0, 0, skyCanvas.width, skyCanvas.height);
    }

    const skyTexture = new THREE.CanvasTexture(skyCanvas);
    const skyMat = new THREE.MeshBasicMaterial({
      map: skyTexture,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false // Disable fog on the sky background dome to avoid washing out
    });
    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    envGroup.add(skyDome);

    // Gorgeous custom twinkling starfield/particle system for space/military simulator operations feel
    const particlesCount = 200;
    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(particlesCount * 3);
    const starColors = new Float32Array(particlesCount * 3);
    const starBaseColor = new THREE.Color(atmosphere.preview.starColor);

    for (let i = 0; i < particlesCount; i++) {
      // Position particles in a random dome above the horizon
      const r = 28 + Math.random() * 32;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random()); // only top hemisphere (Y > 0)
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = Math.abs(r * Math.sin(phi) * Math.sin(theta)) + 1.5;
      starPositions[i * 3 + 2] = r * Math.cos(phi);

      const brightness = 0.72 + Math.random() * 0.28;
      starColors[i * 3] = starBaseColor.r * brightness;
      starColors[i * 3 + 1] = starBaseColor.g * brightness;
      starColors[i * 3 + 2] = starBaseColor.b * brightness;
    }

    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    starGeometry.setAttribute("color", new THREE.BufferAttribute(starColors, 3));

    const starMaterial = new THREE.PointsMaterial({
      size: 0.18,
      vertexColors: true,
      transparent: true,
      opacity: atmosphere.preview.starOpacity,
      sizeAttenuation: true,
      fog: false // Stars remain brilliant
    });

    const starField = new THREE.Points(starGeometry, starMaterial);
    envGroup.add(starField);

    const stormCloudsList: THREE.Mesh[] = [];

    if (mapId === KnownMaps.IslandChain) {
      // Ocean far below
      const oceanGeo = new THREE.PlaneGeometry(160, 160);
      const oceanMat = new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        roughness: 0.2,
        metalness: 0.1,
        flatShading: true
      });
      const ocean = new THREE.Mesh(oceanGeo, oceanMat);
      ocean.rotation.x = -Math.PI / 2;
      ocean.position.y = -10;
      envGroup.add(ocean);

      // Carrier flight Deck under aircraft
      const deckGroup = new THREE.Group();
      deckGroup.position.set(0, -4, 0);

      const deckGeo = new THREE.BoxGeometry(10, 0.6, 40);
      const deckMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.85
      });
      const deck = new THREE.Mesh(deckGeo, deckMat);
      deckGroup.add(deck);

      const stripeGeo = new THREE.PlaneGeometry(0.3, 4);
      const stripeMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide });
      for (let i = -2; i <= 2; i++) {
        const stripe = new THREE.Mesh(stripeGeo, stripeMat);
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(0, 0.31, i * 8);
        deckGroup.add(stripe);
      }

      const boundaryLineGeo = new THREE.PlaneGeometry(0.12, 40);
      const boundaryLineMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
      const leftLine = new THREE.Mesh(boundaryLineGeo, boundaryLineMat);
      leftLine.rotation.x = -Math.PI / 2;
      leftLine.position.set(-4.5, 0.31, 0);
      deckGroup.add(leftLine);

      const rightLine = new THREE.Mesh(boundaryLineGeo, boundaryLineMat);
      rightLine.rotation.x = -Math.PI / 2;
      rightLine.position.set(4.5, 0.31, 0);
      deckGroup.add(rightLine);

      envGroup.add(deckGroup);
    } else if (mapId === KnownMaps.DesertCanyon) {
      // Sandy desert deck
      const sandGeo = new THREE.PlaneGeometry(160, 160);
      const sandMat = new THREE.MeshStandardMaterial({
        color: 0xa16207,
        roughness: 0.95
      });
      const sand = new THREE.Mesh(sandGeo, sandMat);
      sand.rotation.x = -Math.PI / 2;
      sand.position.y = -10;
      envGroup.add(sand);

      // Sandstone canyon rock towers left and right
      const rockMat = new THREE.MeshStandardMaterial({
        color: 0xc27807,
        roughness: 0.9,
        flatShading: true
      });
      for (let i = 0; i < 8; i++) {
        const rH = 14 + Math.random() * 14;
        const rW = 3.5 + Math.random() * 4;
        const rD = 3.5 + Math.random() * 4;
        const rGeo = new THREE.BoxGeometry(rW, rH, rD);
        const rMesh = new THREE.Mesh(rGeo, rockMat);
        const side = i % 2 === 0 ? 1 : -1;
        rMesh.position.set(side * (10 + Math.random() * 5), -10 + rH / 2, -25 + (i * 7));
        envGroup.add(rMesh);
      }
    } else if (mapId === KnownMaps.AlpineValley) {
      // Snowy mountain field
      const snowyGeo = new THREE.PlaneGeometry(160, 160);
      const snowyMat = new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        roughness: 0.8
      });
      const snow = new THREE.Mesh(snowyGeo, snowyMat);
      snow.rotation.x = -Math.PI / 2;
      snow.position.y = -10;
      envGroup.add(snow);

      // Ice pyramids and snowy peaks on both sides
      const peakMat = new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        roughness: 0.7,
        flatShading: true
      });
      const crystalMat = new THREE.MeshStandardMaterial({
        color: 0x93c5fd,
        roughness: 0.15,
        metalness: 0.8
      });
      for (let i = 0; i < 8; i++) {
        const isPeak = i % 3 !== 0;
        const rH = 14 + Math.random() * 16;
        const rRadius = 4 + Math.random() * 4;
        const peakGeo = isPeak ? new THREE.ConeGeometry(rRadius, rH, 4) : new THREE.CylinderGeometry(0.1, rRadius, rH, 5);
        const peak = new THREE.Mesh(peakGeo, isPeak ? peakMat : crystalMat);
        const side = i % 2 === 0 ? 1 : -1;
        peak.position.set(side * (11 + Math.random() * 5), -10 + rH / 2, -28 + (i * 8));
        envGroup.add(peak);
      }
    } else if (mapId === KnownMaps.StormFront) {
      // Dark sea floor
      const stormSeaGeo = new THREE.PlaneGeometry(160, 160);
      const stormSeaMat = new THREE.MeshStandardMaterial({
        color: 0x05131a,
        roughness: 0.18,
        metalness: 0.7
      });
      const sea = new THREE.Mesh(stormSeaGeo, stormSeaMat);
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -10;
      envGroup.add(sea);

      // Dark wet weathered deck
      const deckGeo = new THREE.BoxGeometry(10, 0.6, 40);
      const deckMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.25,
        metalness: 0.4
      });
      const wetDeck = new THREE.Mesh(deckGeo, deckMat);
      wetDeck.position.set(0, -4, 0);
      envGroup.add(wetDeck);

      // Weathered runway stripes
      const stripeGeo = new THREE.PlaneGeometry(0.3, 4);
      const stripeMat = new THREE.MeshBasicMaterial({ color: 0xd97706, side: THREE.DoubleSide });
      for (let i = -2; i <= 2; i++) {
        const stripe = new THREE.Mesh(stripeGeo, stripeMat);
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(0, -3.69, i * 8);
        envGroup.add(stripe);
      }

      // Procedural grey storm clouds
      const cloudMat = new THREE.MeshStandardMaterial({
        color: atmosphere.cloudField.shadowColor,
        roughness: 0.9,
        transparent: true,
        opacity: 0.65
      });
      for (let i = 0; i < 6; i++) {
        const r = 3.5 + Math.random() * 4.5;
        const sphereGeo = new THREE.SphereGeometry(r, 6, 6);
        const cloud = new THREE.Mesh(sphereGeo, cloudMat);
        const side = i % 2 === 0 ? 1 : -1;
        cloud.position.set(side * (13 + Math.random() * 11), 1 + Math.random() * 5, -25 + (i * 9));
        envGroup.add(cloud);
        stormCloudsList.push(cloud);
      }
    }

    // 6. Animation loop
    let animationFrameId: number;
    const timer = new THREE.Timer();

    let isFlashing = false;
    let flashTime = 0;
    let nextLightningTime = THREE.MathUtils.lerp(
      atmosphere.lightning.minDelay,
      atmosphere.lightning.maxDelay,
      Math.random()
    );

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      timer.update();

      const elapsedTime = timer.getElapsed();

      // Spin propellers at high speeds using the "spinZ" tag
      group.traverse((child) => {
        if (child.userData.tags && child.userData.tags.includes("spinZ")) {
          child.rotation.z += 0.32;
        }
      });

      // Slowly rotate the showroom pivot structure
      pivot.rotation.y = elapsedTime * 0.45;

      // Gentle aircraft rocking flight maneuvers (oscillate roll and pitch slightly to feel "alive")
      pivot.rotation.z = Math.sin(elapsedTime * 1.5) * 0.08; // moderate bank oscillation
      pivot.rotation.x = Math.cos(elapsedTime * 1.5) * 0.04; // subtle pitch oscillation
      pivot.position.y = -0.2 + Math.sin(elapsedTime * 2.5) * 0.3; // hovering altitude bounce

      // Interactive twinkling ambient stars
      if (starMaterial) {
        starMaterial.opacity =
          atmosphere.preview.starOpacity *
          (0.8 + Math.sin(elapsedTime * 2.8) * 0.2);
      }

      // Storm cloud drift animation
      if (mapId === KnownMaps.StormFront && stormCloudsList.length > 0) {
        stormCloudsList.forEach((c) => {
          c.position.z += 0.02;
          if (c.position.z > 20) {
            c.position.z = -30;
          }
        });
      }

      // Lightning Thunder Flash Double strike
      if (atmosphere.lightning.enabled) {
        if (elapsedTime >= nextLightningTime && !isFlashing) {
          isFlashing = true;
          flashTime = elapsedTime;
          nextLightningTime =
            elapsedTime +
            THREE.MathUtils.lerp(
              atmosphere.lightning.minDelay,
              atmosphere.lightning.maxDelay,
              Math.random()
            );
        }
        if (isFlashing) {
          const delta = elapsedTime - flashTime;
          if (delta < 0.08) {
            dirLight1.intensity = 2.8;
            ambientLight.intensity = 1.6;
            ambientLight.color.set(atmosphere.lightning.color);
          } else if (delta < 0.16) {
            dirLight1.intensity = 0.2;
            ambientLight.intensity = 0.2;
          } else if (delta < 0.26) {
            dirLight1.intensity = 2.2;
            ambientLight.intensity = 1.3;
            ambientLight.color.set(atmosphere.lightning.color);
          } else {
            isFlashing = false;
            ambientLight.color.set(atmosphere.skyLightColor);
            ambientLight.groundColor.set(atmosphere.groundLightColor);
            ambientLight.intensity = atmosphere.ambientIntensity * 0.72;
            dirLight1.color.set(atmosphere.sunColor);
            dirLight1.intensity = atmosphere.sunIntensity;
          }
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    // 7. Handles Resize
    const handleResize = () => {
      if (!container || !renderer) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(container);

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      if (renderer.domElement) {
        renderer.domElement.remove();
      }
      renderer.dispose();
      scene.clear();
    };
  }, [planeId, skinId, fullScreen, mapId]);

  if (fullScreen) {
    return (
      <div className="relative w-full h-full overflow-hidden flex items-center justify-center">
        <div className="absolute inset-0 pointer-events-none opacity-5 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,_transparent_1px),_linear-gradient(90deg,_rgba(255,255,255,0.05)_1px,_transparent_1px)] bg-[size:32px_32px]" />
        <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      </div>
    );
  }

  return (
    <div className="relative w-full h-[220px] md:h-[260px] bg-gradient-to-b from-slate-950/20 to-slate-900/40 border border-slate-900/60 rounded-xl overflow-hidden flex items-center justify-center shadow-inner">
      {/* Background HUD Grid accents */}
      <div className="absolute inset-0 pointer-events-none opacity-10 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-505 via-slate-950 to-slate-955 bg-grid"></div>
      <div className="absolute top-3 left-4 flex flex-col gap-0.5 pointer-events-none font-mono">
        <span className="text-[9px] text-amber-500 uppercase tracking-widest font-bold">3D Teaser Showroom</span>
        <span className="text-[7px] text-slate-500 uppercase">Live WebGL Preview</span>
      </div>
      <div className="absolute bottom-3 right-4 pointer-events-none text-right font-mono text-[7px] text-slate-600">
        ROTATION: LIVE • COMPASS: SYNCED
      </div>
      {/* Target Canvas container wrapper */}
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
    </div>
  );
}
