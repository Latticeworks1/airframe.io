import * as THREE from 'three';

export class AudioSystem {
  public listener: THREE.AudioListener;
  public radioAudio?: THREE.PositionalAudio;
  public soundtrackGain?: GainNode;
  
  private radioPos: THREE.Vector3;
  private audioCtx: AudioContext;

  constructor(camera: THREE.Camera, scene: THREE.Scene, radioPos: THREE.Vector3 = new THREE.Vector3(0, 100, 0)) {
    this.radioPos = radioPos;
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.audioCtx = this.listener.context;

    this.setupSoundtrack();
    this.setupRadio(scene, radioPos);
  }

  private setupSoundtrack() {
    // Generate a simple ambient drone soundtrack
    const osc1 = this.audioCtx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = 55; // Low A

    const osc2 = this.audioCtx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = 55.5; // Slight detune for phasing

    this.soundtrackGain = this.audioCtx.createGain();
    this.soundtrackGain.gain.value = 0.3; // Default volume

    osc1.connect(this.soundtrackGain);
    osc2.connect(this.soundtrackGain);
    this.soundtrackGain.connect(this.audioCtx.destination);

    osc1.start();
    osc2.start();
  }

  private setupRadio(scene: THREE.Scene, pos: THREE.Vector3) {
    this.radioAudio = new THREE.PositionalAudio(this.listener);
    
    // We generate a continuous synth radio station instead of loading a file for simplicity
    const osc = this.audioCtx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(110, this.audioCtx.currentTime);

    // Modulate the frequency slightly to make it sound like a transmission
    const lfo = this.audioCtx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 2; // 2Hz modulation

    const lfoGain = this.audioCtx.createGain();
    lfoGain.gain.value = 50;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    // Apply a bandpass filter to give it a "radio" sound
    const filter = this.audioCtx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 800;

    const gain = this.audioCtx.createGain();
    gain.gain.value = 0.5;

    osc.connect(filter);
    filter.connect(gain);
    
    // Connect to positional audio
    this.radioAudio.setNodeSource(gain as any);
    
    osc.start();
    lfo.start();

    // Directional setup
    // Muffles when behind listener (i.e. pointing away)
    this.radioAudio.setDirectionalCone(180, 230, 0.1);
    
    this.radioAudio.setRefDistance(500);
    this.radioAudio.setMaxDistance(10000);
    this.radioAudio.setDistanceModel("exponential");
    this.radioAudio.setRolloffFactor(1.5);

    // Add a visual marker for the radio tower
    const radioMesh = new THREE.Mesh(
      new THREE.BoxGeometry(20, 200, 20),
      new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true })
    );
    radioMesh.position.copy(pos);
    radioMesh.add(this.radioAudio);
    scene.add(radioMesh);
  }

  public update() {
    if (!this.radioAudio || !this.soundtrackGain) return;
    
    // Ducking logic: duck soundtrack based on distance to radio
    // The world coordinate of the listener comes from the camera
    const listenerPos = new THREE.Vector3();
    this.listener.getWorldPosition(listenerPos);
    const dist = listenerPos.distanceTo(this.radioPos);
    
    // If closer than 2000 units, start ducking the soundtrack
    const duckFactor = Math.max(0.05, Math.min(0.3, (dist / 2000) * 0.3));
    
    // Smoothly interpolate main soundtrack gain
    this.soundtrackGain.gain.setTargetAtTime(duckFactor, this.audioCtx.currentTime, 0.1);
  }

  public dispose() {
    this.radioAudio?.disconnect();
    this.soundtrackGain?.disconnect();
  }
}
