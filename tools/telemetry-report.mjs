#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const inputPath = path.resolve(
  process.argv[2] ?? path.join(os.tmpdir(), "airframe-telemetry.jsonl")
);
const outputPath = path.resolve(
  process.argv[3] ?? path.join(os.tmpdir(), "airframe-telemetry-report.html")
);

if (!fs.existsSync(inputPath)) {
  console.error(`Telemetry file not found: ${inputPath}`);
  process.exit(1);
}

const lines = fs.readFileSync(inputPath, "utf8").split(/\r?\n/).filter(Boolean);
const rejected = [];
const frames = [];

for (let index = 0; index < lines.length; index++) {
  try {
    const frame = JSON.parse(lines[index]);
    if (
      Number.isFinite(frame.t) &&
      Number.isFinite(frame.spd) &&
      frame.spd > 0
    ) {
      frames.push(frame);
    }
  } catch {
    rejected.push(index + 1);
  }
}

if (frames.length < 2) {
  console.error(`Not enough flight frames in ${inputPath}`);
  process.exit(1);
}

const distance = (a, b) =>
  Math.hypot(
    (b.px ?? 0) - (a.px ?? 0),
    (b.py ?? b.alt ?? 0) - (a.py ?? a.alt ?? 0),
    (b.pz ?? 0) - (a.pz ?? 0)
  );

const lifeStarts = [0];
for (let index = 1; index < frames.length; index++) {
  const previous = frames[index - 1];
  const current = frames[index];
  if (current.t < previous.t || distance(previous, current) > 100) {
    lifeStarts.push(index);
  }
}
lifeStarts.push(frames.length);

const lives = [];
for (let index = 0; index < lifeStarts.length - 1; index++) {
  const start = lifeStarts[index];
  const end = lifeStarts[index + 1];
  const slice = frames.slice(start, end);
  lives.push({
    number: index + 1,
    start,
    end,
    startTime: slice[0].t,
    endTime: slice.at(-1).t,
    duration: slice.at(-1).t - slice[0].t,
    startAltitude: slice[0].alt,
    endAltitude: slice.at(-1).alt,
    stallPercent:
      (100 * slice.filter(frame => frame.lw || frame.rw).length) / slice.length,
    fullElevatorPercent:
      (100 * slice.filter(frame => Math.abs(frame.elv ?? 0) >= 0.95).length) /
      slice.length,
    fullAileronPercent:
      (100 * slice.filter(frame => Math.abs(frame.ail ?? 0) >= 0.95).length) /
      slice.length,
    maxRollRate: Math.max(...slice.map(frame => Math.abs(frame.avP ?? 0))),
    maxPitchRate: Math.max(...slice.map(frame => Math.abs(frame.avQ ?? 0))),
    maxYawRate: Math.max(...slice.map(frame => Math.abs(frame.avR ?? 0))),
    maxAoA: Math.max(...slice.map(frame => Math.abs(frame.aoa ?? 0))),
    maxSideslip: Math.max(...slice.map(frame => Math.abs(frame.ss ?? 0)))
  });
}

const maxAbs = key => Math.max(...frames.map(frame => Math.abs(frame[key] ?? 0)));
const percent = predicate =>
  (100 * frames.filter(predicate).length) / frames.length;
const hasCommandTelemetry = frames.some(frame => Number.isFinite(frame.cp));
const hasManualTelemetry = frames.some(frame => Number.isFinite(frame.mp));
const manualActivePercent = hasManualTelemetry
  ? percent(
      frame =>
        Math.abs(frame.mp ?? 0) > 0.01 ||
        Math.abs(frame.mr ?? 0) > 0.01 ||
        Math.abs(frame.myw ?? 0) > 0.01
    )
  : 0;
const instructorOnlySaturationPercent = hasManualTelemetry
  ? percent(
      frame =>
        Math.abs(frame.mp ?? 0) < 0.01 &&
        Math.abs(frame.mr ?? 0) < 0.01 &&
        Math.abs(frame.myw ?? 0) < 0.01 &&
        (Math.abs(frame.cp ?? 0) > 0.95 ||
          Math.abs(frame.cr ?? 0) > 0.95 ||
          Math.abs(frame.cy ?? 0) > 0.95)
    )
  : 0;

const summary = {
  inputPath,
  outputPath,
  frames: frames.length,
  rejectedLines: rejected.length,
  duration: frames.at(-1).t - frames[0].t,
  lives: lives.length,
  crashes: Math.max(0, lives.length - 1),
  stallPercent: percent(frame => frame.lw || frame.rw),
  fullElevatorPercent: percent(frame => Math.abs(frame.elv ?? 0) >= 0.95),
  fullAileronPercent: percent(frame => Math.abs(frame.ail ?? 0) >= 0.95),
  maxRollRate: maxAbs("avP"),
  maxPitchRate: maxAbs("avQ"),
  maxYawRate: maxAbs("avR"),
  maxAoA: maxAbs("aoa"),
  maxSideslip: maxAbs("ss"),
  minSpeed: Math.min(...frames.map(frame => frame.spd)),
  maxSpeed: Math.max(...frames.map(frame => frame.spd)),
  minAltitude: Math.min(...frames.map(frame => frame.alt)),
  maxAltitude: Math.max(...frames.map(frame => frame.alt)),
  hasCommandTelemetry,
  hasManualTelemetry,
  manualActivePercent,
  instructorOnlySaturationPercent
};

const findings = [];
if (summary.crashes > 0) {
  findings.push(`${summary.crashes} position reset(s) indicate crash/respawn events.`);
}
if (summary.stallPercent > 30) {
  findings.push(
    `The aircraft is stalled for ${summary.stallPercent.toFixed(1)}% of the capture.`
  );
}
if (summary.fullElevatorPercent > 20) {
  findings.push(
    `Elevator saturation is sustained for ${summary.fullElevatorPercent.toFixed(1)}% of frames.`
  );
}
if (summary.fullAileronPercent > 20) {
  findings.push(
    `Aileron saturation is sustained for ${summary.fullAileronPercent.toFixed(1)}% of frames.`
  );
}
if (
  Math.max(summary.maxRollRate, summary.maxPitchRate, summary.maxYawRate) > 150
) {
  findings.push("At least one angular axis exceeds 150°/s.");
}
if (summary.maxAoA > 30) {
  findings.push(`Angle of attack reaches ${summary.maxAoA.toFixed(1)}°.`);
}
if (summary.maxSideslip > 20) {
  findings.push(`Sideslip reaches ${summary.maxSideslip.toFixed(1)}°.`);
}
if (!hasCommandTelemetry) {
  findings.push(
    "This capture predates command/manual-input instrumentation; reload the game and record a fresh session for source attribution."
  );
}
if (hasManualTelemetry && manualActivePercent > 20) {
  findings.push(
    `Direct manual input is active for ${manualActivePercent.toFixed(1)}% of frames; mouse-aim envelope protection is bypassed during those periods.`
  );
}
if (hasManualTelemetry && instructorOnlySaturationPercent > 10) {
  findings.push(
    `The instructor saturates a command without manual override for ${instructorOnlySaturationPercent.toFixed(1)}% of frames.`
  );
}
if (findings.length === 0) {
  findings.push("No obvious saturation, stall, or respawn anomaly was detected.");
}

const safeJson = value =>
  JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Airframe Telemetry Report</title>
  <style>
    :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #071018; color: #d8e6ef; }
    main { max-width: 1500px; margin: 0 auto; padding: 22px; }
    h1 { margin: 0 0 6px; font: 700 24px system-ui; }
    h2 { margin: 28px 0 10px; font: 700 16px system-ui; }
    .muted { color: #7d93a3; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); gap: 10px; margin: 18px 0; }
    .card, .panel { border: 1px solid #203442; background: #0c1821; border-radius: 8px; }
    .card { padding: 12px; }
    .card span { display: block; color: #7891a2; font-size: 11px; }
    .card strong { display: block; margin-top: 5px; font-size: 19px; }
    .findings { margin: 12px 0 22px; padding: 12px 12px 12px 30px; border-left: 3px solid #f59e0b; background: #19170d; }
    .panel { margin: 10px 0; padding: 10px; }
    .panel header { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 7px; }
    .panel h3 { margin: 0; font: 700 13px system-ui; }
    .legend { display: flex; flex-wrap: wrap; gap: 12px; color: #9db0bd; font-size: 11px; }
    .legend i { display: inline-block; width: 12px; height: 3px; margin-right: 5px; vertical-align: middle; }
    canvas { width: 100%; height: 190px; display: block; cursor: crosshair; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { padding: 7px; border-bottom: 1px solid #1d303c; text-align: right; }
    th:first-child, td:first-child { text-align: left; }
    .tooltip { position: fixed; display: none; pointer-events: none; background: #02070bdd; border: 1px solid #496272; border-radius: 5px; padding: 7px; font-size: 11px; white-space: pre; z-index: 10; }
  </style>
</head>
<body>
<main>
  <h1>Airframe Telemetry Report</h1>
  <div class="muted">${inputPath.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</div>
  <div class="cards" id="cards"></div>
  <ul class="findings" id="findings"></ul>
  <div id="charts"></div>
  <h2>Lives / respawns</h2>
  <div class="panel"><table id="lives"></table></div>
</main>
<div class="tooltip" id="tooltip"></div>
<script>
const frames = ${safeJson(frames)};
const summary = ${safeJson(summary)};
const findings = ${safeJson(findings)};
const lives = ${safeJson(lives)};

const cards = [
  ["Frames", summary.frames],
  ["Duration", summary.duration.toFixed(1) + " s"],
  ["Crashes / resets", summary.crashes],
  ["Stalled", summary.stallPercent.toFixed(1) + "%"],
  ["Full elevator", summary.fullElevatorPercent.toFixed(1) + "%"],
  ["Full aileron", summary.fullAileronPercent.toFixed(1) + "%"],
  ["Manual input active", summary.manualActivePercent.toFixed(1) + "%"],
  ["Instructor-only saturation", summary.instructorOnlySaturationPercent.toFixed(1) + "%"],
  ["Max roll rate", summary.maxRollRate.toFixed(1) + " °/s"],
  ["Max pitch rate", summary.maxPitchRate.toFixed(1) + " °/s"],
  ["Max yaw rate", summary.maxYawRate.toFixed(1) + " °/s"],
  ["Max |AoA|", summary.maxAoA.toFixed(1) + "°"],
  ["Max |sideslip|", summary.maxSideslip.toFixed(1) + "°"]
];
document.querySelector("#cards").innerHTML = cards.map(([label, value]) =>
  \`<div class="card"><span>\${label}</span><strong>\${value}</strong></div>\`
).join("");
document.querySelector("#findings").innerHTML =
  findings.map(item => \`<li>\${item}</li>\`).join("");

const chartDefinitions = [
  {
    title: "Commanded controls vs manual input",
    fixed: [-1.05, 1.05],
    series: [
      ["cp", "command pitch", "#fb7185"],
      ["cr", "command roll", "#60a5fa"],
      ["cy", "command yaw", "#4ade80"],
      ["mp", "manual pitch", "#fda4af", true],
      ["mr", "manual roll", "#93c5fd", true],
      ["myw", "manual yaw", "#86efac", true]
    ]
  },
  {
    title: "Aim position",
    fixed: [-1.05, 1.05],
    series: [["ax", "aim X", "#60a5fa"], ["ay", "aim Y", "#fb7185"]]
  },
  {
    title: "Actuator deflection",
    fixed: [-1.05, 1.05],
    series: [
      ["elv", "elevator", "#fb7185"],
      ["ail", "aileron", "#60a5fa"],
      ["rud", "rudder", "#4ade80"]
    ]
  },
  {
    title: "Body angular rates (°/s; pitch is nose-up positive)",
    series: [
      ["avP", "roll", "#60a5fa"],
      ["avQ", "pitch", "#fb7185"],
      ["avR", "yaw", "#4ade80"]
    ]
  },
  {
    title: "Aerodynamic angles (°)",
    thresholds: [-17, 17],
    series: [["aoa", "AoA", "#f59e0b"], ["ss", "sideslip", "#22d3ee"]]
  },
  {
    title: "Speed (km/h)",
    series: [["spd", "speed", "#a78bfa"]]
  },
  {
    title: "Altitude (m)",
    series: [["alt", "altitude", "#fbbf24"]]
  },
  {
    title: "Aerodynamic torque (N·m)",
    series: [["mx", "pitch Mx", "#fb7185"], ["my", "yaw My", "#4ade80"], ["mz", "roll Mz", "#60a5fa"]]
  }
];

const tooltip = document.querySelector("#tooltip");
const minTime = frames[0].t;
const maxTime = frames.at(-1).t;
const lifeMarkers = lives.slice(1).map(life => life.startTime);

function finiteValues(key) {
  return frames.map(frame => frame[key]).filter(Number.isFinite);
}

function createChart(definition) {
  const available = definition.series.filter(([key]) => finiteValues(key).length);
  if (!available.length) return;
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.innerHTML = \`<header><h3>\${definition.title}</h3><div class="legend">\${available.map(([, label, color]) =>
    \`<span><i style="background:\${color}"></i>\${label}</span>\`
  ).join("")}</div></header><canvas></canvas>\`;
  document.querySelector("#charts").append(panel);
  const canvas = panel.querySelector("canvas");

  function draw(pointerX = null) {
    const ratio = devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    const pad = { left: 52, right: 12, top: 8, bottom: 22 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const values = available.flatMap(([key]) => finiteValues(key));
    let minY = definition.fixed?.[0] ?? Math.min(...values);
    let maxY = definition.fixed?.[1] ?? Math.max(...values);
    if (minY === maxY) { minY -= 1; maxY += 1; }
    if (!definition.fixed) {
      const margin = (maxY - minY) * 0.08 || 1;
      minY -= margin;
      maxY += margin;
    }
    const xAt = time => pad.left + ((time - minTime) / Math.max(0.001, maxTime - minTime)) * plotWidth;
    const yAt = value => pad.top + (1 - (value - minY) / (maxY - minY)) * plotHeight;

    context.strokeStyle = "#1c303d";
    context.fillStyle = "#7891a2";
    context.font = "10px ui-monospace";
    context.lineWidth = 1;
    for (let step = 0; step <= 4; step++) {
      const y = pad.top + (plotHeight * step) / 4;
      const value = maxY - ((maxY - minY) * step) / 4;
      context.beginPath(); context.moveTo(pad.left, y); context.lineTo(width - pad.right, y); context.stroke();
      context.fillText(value.toFixed(Math.abs(value) < 10 ? 1 : 0), 4, y + 3);
    }
    for (let step = 0; step <= 6; step++) {
      const time = minTime + ((maxTime - minTime) * step) / 6;
      const x = xAt(time);
      context.beginPath(); context.moveTo(x, pad.top); context.lineTo(x, pad.top + plotHeight); context.stroke();
      context.fillText(time.toFixed(1), x - 12, height - 5);
    }

    context.fillStyle = "#7f1d1d44";
    let stallStart = null;
    for (let index = 0; index <= frames.length; index++) {
      const stalled = index < frames.length && (frames[index].lw || frames[index].rw);
      if (stalled && stallStart === null) stallStart = frames[index].t;
      if (!stalled && stallStart !== null) {
        const end = frames[Math.max(0, index - 1)].t;
        context.fillRect(xAt(stallStart), pad.top, Math.max(1, xAt(end) - xAt(stallStart)), plotHeight);
        stallStart = null;
      }
    }
    context.strokeStyle = "#ef4444";
    context.setLineDash([5, 4]);
    for (const time of lifeMarkers) {
      const x = xAt(time);
      context.beginPath(); context.moveTo(x, pad.top); context.lineTo(x, pad.top + plotHeight); context.stroke();
    }
    for (const threshold of definition.thresholds ?? []) {
      if (threshold < minY || threshold > maxY) continue;
      const y = yAt(threshold);
      context.beginPath(); context.moveTo(pad.left, y); context.lineTo(width - pad.right, y); context.stroke();
    }
    context.setLineDash([]);

    for (const [key, , color, dashed] of available) {
      context.strokeStyle = color;
      context.lineWidth = 1.4;
      context.setLineDash(dashed ? [5, 4] : []);
      context.beginPath();
      let started = false;
      for (const frame of frames) {
        const value = frame[key];
        if (!Number.isFinite(value)) continue;
        const x = xAt(frame.t);
        const y = yAt(value);
        if (!started) { context.moveTo(x, y); started = true; }
        else context.lineTo(x, y);
      }
      context.stroke();
    }
    context.setLineDash([]);

    if (pointerX !== null) {
      context.strokeStyle = "#e2e8f0aa";
      context.beginPath(); context.moveTo(pointerX, pad.top); context.lineTo(pointerX, pad.top + plotHeight); context.stroke();
    }
  }

  canvas.addEventListener("mousemove", event => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(52, Math.min(rect.width - 12, event.clientX - rect.left));
    const time = minTime + ((x - 52) / Math.max(1, rect.width - 64)) * (maxTime - minTime);
    let nearest = frames[0];
    for (const frame of frames) {
      if (Math.abs(frame.t - time) < Math.abs(nearest.t - time)) nearest = frame;
    }
    tooltip.style.display = "block";
    tooltip.style.left = Math.min(innerWidth - 220, event.clientX + 12) + "px";
    tooltip.style.top = Math.min(innerHeight - 120, event.clientY + 12) + "px";
    tooltip.textContent = [
      "t " + nearest.t.toFixed(3) + " s",
      ...available.map(([key, label]) =>
        label + " " + (Number.isFinite(nearest[key]) ? Number(nearest[key]).toFixed(3) : "n/a")
      ),
      "stall " + ((nearest.lw || nearest.rw) ? "YES" : "no")
    ].join("\\n");
    draw(x);
  });
  canvas.addEventListener("mouseleave", () => { tooltip.style.display = "none"; draw(); });
  new ResizeObserver(() => draw()).observe(canvas);
  draw();
}

for (const definition of chartDefinitions) createChart(definition);

document.querySelector("#lives").innerHTML =
  "<thead><tr><th>Life</th><th>Time</th><th>Duration</th><th>Altitude</th><th>Stall</th><th>Full elevator</th><th>Full aileron</th><th>Max rates R/P/Y</th><th>Max AoA</th><th>Max slip</th></tr></thead><tbody>" +
  lives.map(life => \`<tr>
    <td>\${life.number}</td>
    <td>\${life.startTime.toFixed(1)}–\${life.endTime.toFixed(1)}</td>
    <td>\${life.duration.toFixed(1)}s</td>
    <td>\${life.startAltitude.toFixed(0)}→\${life.endAltitude.toFixed(0)}</td>
    <td>\${life.stallPercent.toFixed(1)}%</td>
    <td>\${life.fullElevatorPercent.toFixed(1)}%</td>
    <td>\${life.fullAileronPercent.toFixed(1)}%</td>
    <td>\${life.maxRollRate.toFixed(0)} / \${life.maxPitchRate.toFixed(0)} / \${life.maxYawRate.toFixed(0)}</td>
    <td>\${life.maxAoA.toFixed(1)}°</td>
    <td>\${life.maxSideslip.toFixed(1)}°</td>
  </tr>\`).join("") + "</tbody>";
</script>
</body>
</html>`;

fs.writeFileSync(outputPath, html);

console.log(`Telemetry report: ${outputPath}`);
console.log(
  JSON.stringify(
    {
      frames: summary.frames,
      durationSeconds: Number(summary.duration.toFixed(2)),
      crashes: summary.crashes,
      stallPercent: Number(summary.stallPercent.toFixed(1)),
      maxRates: {
        roll: summary.maxRollRate,
        pitch: summary.maxPitchRate,
        yaw: summary.maxYawRate
      },
      inputTelemetry: hasCommandTelemetry
    },
    null,
    2
  )
);
