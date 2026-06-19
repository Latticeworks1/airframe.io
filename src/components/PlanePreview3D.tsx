/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { DEFAULT_AIRCRAFT, AIRCRAFT_DEFINITIONS, MAPS } from "../game/aircraftData";
import { createAircraftMesh } from "../game/content/aircraft/aircraftBuilder";
import { GameMap } from "../types";

interface PlanePreview3DProps {
  planeId: string;
  fullScreen?: boolean;
  skinId?: string;
  mapId?: GameMap;
}

export function PlanePreview3D({
  planeId,
  fullScreen = false,
  skinId = "default",
  mapId = GameMap.IslandChain
}: PlanePreview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || 300;
    const height = container.clientHeight || 200;

    // 1. Scene setup
    const scene = new THREE.Scene();

    // Map specs and thematic configurations
    const mapSpecs = MAPS.find((m) => m.id === mapId) || MAPS[0];

    // Select custom slate bg color theme based on operations theater to look integrated with the pilot overlay HUD
    let lobbyBgHex = "#03060c";
    if (mapId === GameMap.IslandChain) {
      lobbyBgHex = "#040e1d";
    } else if (mapId === GameMap.DesertCanyon) {
      lobbyBgHex = "#1a0f05";
    } else if (mapId === GameMap.AlpineValley) {
      lobbyBgHex = "#0b1018";
    } else if (mapId === GameMap.StormFront) {
      lobbyBgHex = "#030509";
    }

    scene.background = new THREE.Color(lobbyBgHex);

    // Setup linear atmospheric fog with blending horizon color and comfortable depth limit so front plane is sharp
    let envFogColor = "#bae6fd";
    if (mapId === GameMap.IslandChain) {
      envFogColor = "#60a5fa"; // Rich beautiful cyan-blue horizon fog
    } else if (mapId === GameMap.DesertCanyon) {
      envFogColor = "#fdba74"; // Warm sunset desert orange-yellow
    } else if (mapId === GameMap.AlpineValley) {
      envFogColor = "#94a3b8"; // Crisp high-altitude slate slate gray
    } else if (mapId === GameMap.StormFront) {
      envFogColor = "#020617"; // Black-blue storm horizon fog
    }

    if (fullScreen) {
      scene.fog = new THREE.Fog(envFogColor, 28, 90);
    } else {
      scene.fog = new THREE.Fog(envFogColor, 18, 55);
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

    // 4. Lighting - Sleek aerospace display-showroom setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.25);
    dirLight1.position.set(20, 30, 15);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffd700, 0.35); // subtle gold warm side-light
    dirLight2.position.set(-20, -10, -15);
    scene.add(dirLight2);

    // Light custom theme modifications matching active map
    if (mapId === GameMap.DesertCanyon) {
      ambientLight.color.setHex(0xffedd5);
      ambientLight.intensity = 0.55;
      dirLight1.color.setHex(0xfdba74);
      dirLight1.intensity = 1.4;
      dirLight2.color.setHex(0xc2410c);
      dirLight2.intensity = 0.45;
    } else if (mapId === GameMap.AlpineValley) {
      ambientLight.color.setHex(0xe0f2fe);
      ambientLight.intensity = 0.6;
      dirLight1.color.setHex(0xffffff);
      dirLight1.intensity = 1.35;
      dirLight2.color.setHex(0x38bdf8);
      dirLight2.intensity = 0.45;
    } else if (mapId === GameMap.StormFront) {
      ambientLight.color.setHex(0x1e293b);
      ambientLight.intensity = 0.25;
      dirLight1.color.setHex(0x94a3b8);
      dirLight1.intensity = 0.4;
      dirLight2.color.setHex(0x0f172a);
      dirLight2.intensity = 0.1;
    } else {
      // IslandChain - default tropical bright setup
      ambientLight.color.setHex(0xffffff);
      ambientLight.intensity = 0.45;
      dirLight1.color.setHex(0xbae6fd);
      dirLight1.intensity = 1.3;
      dirLight2.color.setHex(0x0ea5e9);
      dirLight2.intensity = 0.35;
    }

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
      if (mapId === GameMap.IslandChain) {
        gradient.addColorStop(0, "#014e7a"); // Top: deep ocean sky
        gradient.addColorStop(0.5, "#0ea5e9"); // Middle: tropical blue
        gradient.addColorStop(1, "#bae6fd"); // Horizon: light warm cyan
      } else if (mapId === GameMap.DesertCanyon) {
        gradient.addColorStop(0, "#2c1c0a"); // Top: dusty twilight
        gradient.addColorStop(0.5, "#ca6a14"); // Middle: scorched sand sunset
        gradient.addColorStop(1, "#fed7aa"); // Horizon: sand glow
      } else if (mapId === GameMap.AlpineValley) {
        gradient.addColorStop(0, "#0f172a"); // Top: cold deep space navy
        gradient.addColorStop(0.5, "#3b82f6"); // Middle: clear high altitude blue
        gradient.addColorStop(1, "#f1f5f9"); // Horizon: icy glare
      } else { // StormFront
        gradient.addColorStop(0, "#020617"); // Top: absolute black storm core
        gradient.addColorStop(0.5, "#0f172a"); // Middle: thundercloud slate
        gradient.addColorStop(1, "#1e293b"); // Horizon: misty dim sea line
      }
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

    for (let i = 0; i < particlesCount; i++) {
      // Position particles in a random dome above the horizon
      const r = 28 + Math.random() * 32;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random()); // only top hemisphere (Y > 0)
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = Math.abs(r * Math.sin(phi) * Math.sin(theta)) + 1.5;
      starPositions[i * 3 + 2] = r * Math.cos(phi);

      // Star color matching active theater maps
      if (mapId === GameMap.DesertCanyon) {
        starColors[i * 3] = 1.0;
        starColors[i * 3 + 1] = 0.8 + Math.random() * 0.2;
        starColors[i * 3 + 2] = 0.55;
      } else if (mapId === GameMap.AlpineValley) {
        starColors[i * 3] = 0.85;
        starColors[i * 3 + 1] = 0.95;
        starColors[i * 3 + 2] = 1.0;
      } else if (mapId === GameMap.StormFront) {
        starColors[i * 3] = 0.7;
        starColors[i * 3 + 1] = 0.85;
        starColors[i * 3 + 2] = 1.0; // electric lightning blue
      } else {
        starColors[i * 3] = 0.9;
        starColors[i * 3 + 1] = 0.95;
        starColors[i * 3 + 2] = 1.0;
      }
    }

    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    starGeometry.setAttribute("color", new THREE.BufferAttribute(starColors, 3));

    const starMaterial = new THREE.PointsMaterial({
      size: 0.18,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
      fog: false // Stars remain brilliant
    });

    const starField = new THREE.Points(starGeometry, starMaterial);
    envGroup.add(starField);

    const stormCloudsList: THREE.Mesh[] = [];

    if (mapId === GameMap.IslandChain) {
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
    } else if (mapId === GameMap.DesertCanyon) {
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
    } else if (mapId === GameMap.AlpineValley) {
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
    } else if (mapId === GameMap.StormFront) {
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
        color: 0x1f2937,
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
        starMaterial.opacity = 0.65 + Math.sin(elapsedTime * 2.8) * 0.25;
      }

      // Storm cloud drift animation
      if (mapId === GameMap.StormFront && stormCloudsList.length > 0) {
        stormCloudsList.forEach((c) => {
          c.position.z += 0.02;
          if (c.position.z > 20) {
            c.position.z = -30;
          }
        });
      }

      // Lightning Thunder Flash Double strike
      if (mapId === GameMap.StormFront) {
        if (Math.random() < 0.0035 && !isFlashing) {
          isFlashing = true;
          flashTime = elapsedTime;
        }
        if (isFlashing) {
          const delta = elapsedTime - flashTime;
          if (delta < 0.08) {
            dirLight1.intensity = 2.8;
            ambientLight.intensity = 1.6;
            ambientLight.color.setHex(0xf1f5f9); // bright pure white strike
          } else if (delta < 0.16) {
            dirLight1.intensity = 0.2;
            ambientLight.intensity = 0.2;
          } else if (delta < 0.26) {
            dirLight1.intensity = 2.2;
            ambientLight.intensity = 1.3;
            ambientLight.color.setHex(0xf1f5f9); // second shock strike
          } else {
            isFlashing = false;
            // Restore storm front dim state
            ambientLight.color.setHex(0x1e293b);
            ambientLight.intensity = 0.25;
            dirLight1.color.setHex(0x94a3b8);
            dirLight1.intensity = 0.4;
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
