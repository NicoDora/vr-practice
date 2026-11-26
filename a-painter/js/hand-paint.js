/* global AFRAME THREE */
// 핸드트래킹 핀치로 A-Painter 브러시를 조작한다.
//
// 구조
//   - hand-tracking-controls 엔티티: 손 모델 표시만 담당
//   - 이 컴포넌트를 붙인 엔티티(brush 포함): 매 프레임 핀치 지점으로 옮기고,
//     핀치 시작·끝에 paint 이벤트를 보내서 A-Painter의 기존 brush 코드로 선을 그린다.
//
// A-Frame 1.3의 hand-tracking-controls는 관절 좌표를 저장해 두지 않아서
// WebXR 프레임에서 엄지 끝, 검지 끝, 손목 관절을 직접 읽는다.

AFRAME.registerComponent('hand-paint', {
  dependencies: ['brush'],

  schema: {
    hand: { default: 'right', oneOf: ['left', 'right'] },
    pressure: { default: 1 }, // 핀치는 켜짐/꺼짐뿐이라 굵기 배율을 고정한다. (굵기는 brush.size로 조절)

    // 핀치 판정 (m). 시작과 끝 거리를 다르게 둬서 경계에서 선이 끊겼다 이어지지 않게 한다.
    pinchStartDistance: { default: 0.015 }, // 엄지·검지 끝이 이보다 가까우면 그리기 시작
    pinchHoldDistance: { default: 0.02 }, // 이보다 벌어지면 붓끝을 멈춘다. (손가락을 떼는 동안 생기는 꼬리 방지)
    pinchEndDistance: { default: 0.025 }, // 이보다 벌어지면 그리기 끝

    lostTrackingTimeout: { default: 150 }, // ms, 손 추적이 이 시간 이상 끊기면 그리기를 끝낸다.
    // 손목에서 검지 끝까지가 이보다 짧으면 실제 손이 아니라고 본다. (m, 실제 손은 15cm 안팎)
    minHandSize: { default: 0.05 },

    debug: { default: false }
  },

  init: function () {
    var el = this.el;
    var sceneEl = el.sceneEl;

    this.thumbTip = new THREE.Vector3();
    this.indexTip = new THREE.Vector3();
    this.pinchPoint = new THREE.Vector3();
    this.wristQuaternion = new THREE.Quaternion();
    this.wristPosition = new THREE.Vector3();

    this.painting = false;
    this.holding = false; // 손가락을 떼는 중이라 붓끝을 멈춘 상태
    this.lostTime = 0;
    this.debugTime = 0;
    this.state = { tracked: false, distance: 0, painting: false, holding: false };

    el.object3D.visible = false;

    // brush.hand는 엔티티 id로 정해지는데, 손 브러시는 컨트롤러 붓끝 보정을 쓰면 안 된다.
    // 'pinch'로 표시해 두고 아래 getPointerPosition 보정에서 걸러 낸다.
    el.components.brush.hand = 'pinch';
    patchPointerPosition(sceneEl.systems.brush);

    this.onExitVR = this.stopPainting.bind(this);
    sceneEl.addEventListener('exit-vr', this.onExitVR);
  },

  remove: function () {
    this.stopPainting();
    this.el.sceneEl.removeEventListener('exit-vr', this.onExitVR);
  },

  // 이 손의 엄지 끝, 검지 끝, 손목 위치를 읽는다. 추적 중이 아니면 false
  // 좌표는 XR 기준 공간 기준이고, 이 엔티티는 cameraRig 안에 있어서 그대로 로컬 좌표로 쓸 수 있다.
  readJoints: function () {
    var sceneEl = this.el.sceneEl;
    var frame = sceneEl.frame;
    var session = sceneEl.xrSession;
    var referenceSpace = sceneEl.renderer.xr.getReferenceSpace();
    if (!frame || !session || !referenceSpace || !frame.getJointPose) { return false; }

    var inputSource = null;
    for (var i = 0; i < session.inputSources.length; i++) {
      var source = session.inputSources[i];
      if (source.hand && source.handedness === this.data.hand) { inputSource = source; break; }
    }
    if (!inputSource) { return false; }

    var hand = inputSource.hand;
    var thumb = frame.getJointPose(hand.get('thumb-tip'), referenceSpace);
    var index = frame.getJointPose(hand.get('index-finger-tip'), referenceSpace);
    var wrist = frame.getJointPose(hand.get('wrist'), referenceSpace);
    if (!thumb || !index || !wrist) { return false; }

    this.thumbTip.copy(thumb.transform.position);
    this.indexTip.copy(index.transform.position);
    this.wristPosition.copy(wrist.transform.position);
    this.wristQuaternion.copy(wrist.transform.orientation);

    // 손이 카메라 시야를 벗어나면 Quest가 추적 중으로 둔 채 모든 관절을 한 점에 모아서 보낸다.
    // 엄지와 검지 끝이 겹쳐 핀치로 잡히고, 움직이지 않는 가짜 선이 시작되므로 추적이 끊긴 것으로 처리한다.
    if (this.wristPosition.distanceTo(this.indexTip) < this.data.minHandSize) { return false; }
    return true;
  },

  startPainting: function () {
    if (this.painting) { return; }
    this.applyPose(this.pinchPoint, this.wristQuaternion);
    this.painting = true;
    this.holding = false;
    this.el.emit('paint', { value: this.data.pressure });
    if (this.data.debug) { console.log('hand-paint start', this.data.hand); }
  },

  stopPainting: function () {
    if (!this.painting) { return; }
    this.painting = false;
    this.holding = false;
    this.el.emit('paint', { value: 0 });
    if (this.data.debug) { console.log('hand-paint end', this.data.hand); }
  },

  applyPose: function (position, quaternion) {
    var object3D = this.el.object3D;
    object3D.position.copy(position);
    object3D.quaternion.copy(quaternion);
    object3D.updateMatrixWorld(true);
  },

  tick: function (time, timeDelta) {
    var data = this.data;
    var tracked = this.readJoints();

    this.state.tracked = tracked;
    if (!tracked) {
      // 추적이 잠깐 끊긴 동안은 붓끝을 그대로 두고, 오래 끊기면 그리기를 끝낸다.
      // (손을 잃으면 핀치가 끝났다는 신호가 오지 않을 수 있다)
      this.lostTime += timeDelta;
      if (this.painting && this.lostTime > data.lostTrackingTimeout) { this.stopPainting(); }
      this.el.object3D.visible = false;
      return;
    }
    this.lostTime = 0;
    this.el.object3D.visible = true;

    var distance = this.thumbTip.distanceTo(this.indexTip);
    this.pinchPoint.copy(this.thumbTip).add(this.indexTip).multiplyScalar(0.5);
    this.state.distance = distance;

    if (!this.painting && distance < data.pinchStartDistance) {
      this.startPainting();
    } else if (this.painting && distance > data.pinchEndDistance) {
      this.stopPainting();
    } else if (this.painting && distance > data.pinchHoldDistance) {
      this.holding = true;
    } else if (this.painting && distance < data.pinchStartDistance) {
      this.holding = false; // 다시 붙이면 계속 그린다.
    }

    // 손가락을 떼는 중에는 붓끝을 움직이지 않는다.
    if (!this.holding) {
      this.applyPose(this.pinchPoint, this.wristQuaternion);
    }

    this.state.painting = this.painting;
    this.state.holding = this.holding;

    if (data.debug) {
      this.debugTime += timeDelta;
      if (this.debugTime >= 200) {
        this.debugTime = 0;
        console.log('hand-paint', data.hand,
          'dist', (distance * 1000).toFixed(1) + 'mm',
          this.painting ? (this.holding ? 'hold' : 'paint') : 'idle');
      }
    }
  }
});

// A-Painter의 brush 시스템은 마지막으로 연결된 컨트롤러 이름으로 붓끝 보정값을 고른다.
// 손이 연결되면 이름이 hand-tracking-controls로 바뀌어 보정값이 없어서 오류가 나므로,
// 보정값이 없는 경우와 손 브러시('pinch')는 위치를 그대로 쓴다.
var KNOWN_CONTROLLERS = ['vive-controls', 'oculus-touch-controls', 'windows-motion-controls'];
function patchPointerPosition (brushSystem) {
  if (brushSystem.handPaintPatched) { return; }
  var original = brushSystem.getPointerPosition;
  brushSystem.getPointerPosition = function (position, orientation, hand) {
    if (hand === 'pinch' || KNOWN_CONTROLLERS.indexOf(this.controllerName) === -1) {
      return position;
    }
    return original.call(this, position, orientation, hand);
  };
  brushSystem.handPaintPatched = true;
}
