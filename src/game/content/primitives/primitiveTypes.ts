export type Vec3 = [number, number, number];

export type PrimitiveKind =
  | "box"
  | "wedge"
  | "cylinder"
  | "sphere";

export type PrimitiveRole =
  | "fuselage"
  | "nose"
  | "canopy"
  | "wing"
  | "tail"
  | "engine"
  | "propeller"
  | "weapon"
  | "decor";

export interface BlockPrimitiveDef {
  id: string;
  kind: PrimitiveKind;
  role: PrimitiveRole;
  position: Vec3;
  rotation?: Vec3;
  scale: Vec3;
  material: string;
  tags?: string[];
  damageComponent?:
    | "engine"
    | "leftWing"
    | "rightWing"
    | "tail"
    | "cockpit"
    | "fuelTank"
    | "fuselage";
}
