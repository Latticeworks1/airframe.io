// Written to each frame by CameraManager when in first-person view.
// Read each RAF by CockpitPanel without going through React state.
export const cockpitPanelState = {
  active: false,
  speed01: 0,
  alt01: 0,
  heading01: 0,
  throttle01: 0,
  pitch_rad: 0,
  roll_rad: 0,
  vsi01: 0,
  gearDown: false,
  flapsOut: false,
  airbrakeOn: false,
  engineDamaged: false,
};
