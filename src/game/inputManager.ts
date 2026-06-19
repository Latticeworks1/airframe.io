/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { KeyState, InputEdges, InputFrame } from "../types";

type BindableKey = keyof KeyState;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName.toLowerCase();

  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
}

export class InputManager {
  public held: KeyState = {
    w: false,
    s: false,
    a: false,
    d: false,
    q: false,
    e: false,
    b: false,
    f: false,
    g: false,
    shift: false,
    control: false,
    space: false,
    r: false,
    arrowUp: false,
    arrowDown: false,
    arrowLeft: false,
    arrowRight: false,
  };

  public edges: InputEdges = {
    flapsPressed: false,
    gearPressed: false,
    cameraPressed: false,
    resetPressed: false,
  };

  public mousePos = { x: 0, y: 0 };
  public mouseDelta = { x: 0, y: 0 };
  public rightMouse = false;

  public onCameraToggle?: () => void;
  public onAirbrakeToggle?: () => void;
  public onFlapsCycle?: () => void;
  public onGearToggle?: () => void;
  public onReset?: () => void;

  private initialized = false;
  private fireKeyboard = false;
  private fireMouse = false;

  constructor(private readonly target: HTMLElement | Window = window) {}

  private readonly codeToKey: Record<string, BindableKey> = {
    KeyW: "w",
    KeyS: "s",
    KeyA: "a",
    KeyD: "d",
    KeyQ: "q",
    KeyE: "e",
    ShiftLeft: "shift",
    ShiftRight: "shift",
    ControlLeft: "control",
    ControlRight: "control",
    ArrowUp: "arrowUp",
    ArrowDown: "arrowDown",
    ArrowLeft: "arrowLeft",
    ArrowRight: "arrowRight",
  };

  private setFireState() {
    this.held.space = this.fireKeyboard || this.fireMouse;
  }

  private resetKeys = () => {
    for (const key of Object.keys(this.held) as BindableKey[]) {
      this.held[key] = false;
    }

    this.edges.flapsPressed = false;
    this.edges.gearPressed = false;
    this.edges.cameraPressed = false;
    this.edges.resetPressed = false;

    this.fireKeyboard = false;
    this.fireMouse = false;
    this.rightMouse = false;
    this.mouseDelta = { x: 0, y: 0 };
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;

    const mappedKey = this.codeToKey[e.code];

    if (mappedKey) {
      this.held[mappedKey] = true;

      if (
        e.code.startsWith("Arrow") ||
        e.code === "Space" ||
        e.code === "ControlLeft" ||
        e.code === "ControlRight"
      ) {
        e.preventDefault();
      }

      return;
    }

    if (e.code === "Space") {
      this.fireKeyboard = true;
      this.setFireState();
      e.preventDefault();
      return;
    }

    if (e.repeat) return;

    switch (e.code) {
      case "KeyB":
        this.held.b = true;
        this.onAirbrakeToggle?.();
        break;

      case "KeyF":
        this.held.f = true;
        this.edges.flapsPressed = true;
        this.onFlapsCycle?.();
        break;

      case "KeyG":
        this.held.g = true;
        this.edges.gearPressed = true;
        this.onGearToggle?.();
        break;

      case "KeyR":
        this.held.r = true;
        this.edges.resetPressed = true;
        this.onReset?.();
        e.preventDefault();
        break;

      case "KeyC":
        this.edges.cameraPressed = true;
        this.onCameraToggle?.();
        e.preventDefault();
        break;
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;

    const mappedKey = this.codeToKey[e.code];

    if (mappedKey) {
      this.held[mappedKey] = false;

      if (e.code.startsWith("Arrow")) {
        e.preventDefault();
      }

      return;
    }

    switch (e.code) {
      case "Space":
        this.fireKeyboard = false;
        this.setFireState();
        e.preventDefault();
        break;

      case "KeyB":
        this.held.b = false;
        break;

      case "KeyF":
        this.held.f = false;
        break;

      case "KeyG":
        this.held.g = false;
        break;

      case "KeyR":
        this.held.r = false;
        break;
    }
  };

  private handleMouseMove = (e: MouseEvent) => {
    const element =
      this.target instanceof Window ? document.documentElement : this.target;

    const rect = element.getBoundingClientRect();

    this.mousePos.x = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
    this.mousePos.y = Math.max(-1, Math.min(1, -((e.clientY - rect.top) / rect.height) * 2 + 1));

    // Accumulate raw movement (unbounded by screen edges, correct even at corners)
    const hw = rect.width / 2;
    const hh = rect.height / 2;
    this.mouseDelta.x += e.movementX / hw;
    this.mouseDelta.y += -e.movementY / hh;
  };

  private handleContextMenu = (e: Event) => {
    e.preventDefault();
  };

  private handleMouseDown = (e: MouseEvent) => {
    if (e.button === 0) {
      this.fireMouse = true;
      this.setFireState();
    } else if (e.button === 2) {
      this.rightMouse = true;
    }
  };

  private handleMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      this.fireMouse = false;
      this.setFireState();
    } else if (e.button === 2) {
      this.rightMouse = false;
    }
  };

  public init() {
    if (this.initialized) return;
    this.initialized = true;

    const eventTarget = this.target;

    eventTarget.addEventListener("keydown", this.handleKeyDown as EventListener);
    eventTarget.addEventListener("keyup", this.handleKeyUp as EventListener);
    eventTarget.addEventListener("mousemove", this.handleMouseMove as EventListener);
    eventTarget.addEventListener("mousedown", this.handleMouseDown as EventListener);
    eventTarget.addEventListener("mouseup", this.handleMouseUp as EventListener);
    eventTarget.addEventListener("contextmenu", this.handleContextMenu as EventListener);

    window.addEventListener("blur", this.resetKeys);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  public destroy() {
    if (!this.initialized) return;
    this.initialized = false;

    const eventTarget = this.target;

    eventTarget.removeEventListener("keydown", this.handleKeyDown as EventListener);
    eventTarget.removeEventListener("keyup", this.handleKeyUp as EventListener);
    eventTarget.removeEventListener("mousemove", this.handleMouseMove as EventListener);
    eventTarget.removeEventListener("mousedown", this.handleMouseDown as EventListener);
    eventTarget.removeEventListener("mouseup", this.handleMouseUp as EventListener);
    eventTarget.removeEventListener("contextmenu", this.handleContextMenu as EventListener);

    window.removeEventListener("blur", this.resetKeys);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);

    this.resetKeys();
  }

  public clearPressedEdges() {
    this.edges.flapsPressed = false;
    this.edges.gearPressed = false;
    this.edges.cameraPressed = false;
    this.edges.resetPressed = false;
    this.mouseDelta = { x: 0, y: 0 };
  }

  public getInputFrame(): InputFrame {
    return {
      held: { ...this.held },
      edges: { ...this.edges },
      mousePos: { ...this.mousePos },
      mouseDelta: { ...this.mouseDelta },
      rightMouse: this.rightMouse,
    };
  }

  private handleVisibilityChange = () => {
    if (document.hidden) {
      this.resetKeys();
    }
  };
}
