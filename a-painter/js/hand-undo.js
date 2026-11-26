/* global AFRAME THREE */
// 왼손으로 짧게 핀치하면 마지막 선을 지운다. (컨트롤러 grip 버튼과 같은 실행 취소)
//
// 잘못 지우지 않도록 아래 조건을 모두 만족할 때만 실행 취소한다.
//   - 손바닥이 아래를 향함 (손바닥을 위로 펴는 메뉴 동작과 겹치지 않게)
//   - 핀치를 짧게 했다 뗌 (maxDuration 이하)
//   - 핀치하는 동안 손이 거의 움직이지 않음 (maxMove 이하)
//   - 손 메뉴가 열려 있지 않음 (scene의 hand-menu-open 상태)
//   - 어떤 브러시도 선을 그리는 중이 아님
//     (그리는 중에 지우면 A-Painter가 그리고 있는 선을 지운 뒤에도 그 선에 점을 계속 더해서
//      선이 검게 깨지고, 이전 선은 남는다)
AFRAME.registerComponent('hand-undo', {
  schema: {
    hand: { default: 'left', oneOf: ['left', 'right'] },
    target: { type: 'selector', default: '#right-pinch-brush' }, // undo 이벤트를 받을 brush 엔티티

    pinchStartDistance: { default: 0.015 }, // m
    pinchEndDistance: { default: 0.025 }, // m
    maxDuration: { default: 300 }, // ms, 이보다 오래 잡고 있으면 실행 취소하지 않음
    maxMove: { default: 0.05 }, // m, 핀치하는 동안 이보다 많이 움직이면 실행 취소하지 않음
    palmDownThreshold: { default: 0.5 }, // 손바닥 방향의 아래쪽 성분이 이보다 커야 "아래를 향함"
    minHandSize: { default: 0.05 }, // m, 손목~검지 끝이 이보다 짧으면 추적이 끊긴 것으로 봄 (hand-paint와 같은 이유)
    cooldown: { default: 300 }, // ms, 연속 실행 방지

    debug: { default: false }
  },

  init: function () {
    this.thumbTip = new THREE.Vector3();
    this.indexTip = new THREE.Vector3();
    this.wristPosition = new THREE.Vector3();
    this.wristQuaternion = new THREE.Quaternion();
    this.palmNormal = new THREE.Vector3();
    this.pinchStartPosition = new THREE.Vector3();

    this.pinching = false;
    this.pinchStartTime = 0;
    this.pinchValid = false; // 이번 핀치가 실행 취소 조건을 지금까지 만족하는지
    this.lastUndoTime = -Infinity;
    this.state = { tracked: false, distance: 0, palmDown: false, palmY: 0, pinching: false, undoCount: 0, lastResult: '' };
  },

  // 엄지 끝, 검지 끝, 손목을 읽는다. 추적 중이 아니면 false
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
    if (this.wristPosition.distanceTo(this.indexTip) < this.data.minHandSize) { return false; }
    return true;
  },

  tick: function (time) {
    var data = this.data;
    var tracked = this.readJoints();
    this.state.tracked = tracked;
    if (!tracked) {
      this.pinching = false; // 추적이 끊기면 진행 중인 핀치는 버린다.
      this.state.pinching = false;
      return;
    }

    // WebXR 관절의 -Y 방향이 손바닥이 향하는 방향이다.
    this.palmNormal.set(0, -1, 0).applyQuaternion(this.wristQuaternion);
    var palmDown = -this.palmNormal.y > data.palmDownThreshold;
    var distance = this.thumbTip.distanceTo(this.indexTip);
    this.state.distance = distance;
    this.state.palmY = this.palmNormal.y;
    this.state.palmDown = palmDown;

    if (!this.pinching && distance < data.pinchStartDistance) {
      this.pinching = true;
      this.pinchStartTime = time;
      this.pinchStartPosition.copy(this.indexTip);
      var menuOpen = this.el.sceneEl.is('hand-menu-open');
      var drawing = this.isAnyBrushDrawing();
      this.pinchValid = palmDown && !menuOpen && !drawing;
      this.state.lastResult = this.pinchValid ? 'pinch'
        : !palmDown ? 'palm not down' : menuOpen ? 'menu open' : 'drawing';
    } else if (this.pinching) {
      if (this.indexTip.distanceTo(this.pinchStartPosition) > data.maxMove) {
        if (this.pinchValid) { this.state.lastResult = 'moved'; }
        this.pinchValid = false;
      }
      if (time - this.pinchStartTime > data.maxDuration) {
        if (this.pinchValid) { this.state.lastResult = 'too long'; }
        this.pinchValid = false;
      }
      if (distance > data.pinchEndDistance) {
        this.pinching = false;
        // 핀치하는 사이에 다른 손으로 그리기 시작했을 수도 있어서 한 번 더 확인한다.
        if (this.pinchValid && this.isAnyBrushDrawing()) { this.state.lastResult = 'drawing'; this.pinchValid = false; }
        if (this.pinchValid && time - this.lastUndoTime > data.cooldown) { this.undo(time); }
      }
    }
    this.state.pinching = this.pinching;
  },

  // 손 브러시와 컨트롤러 브러시 중 하나라도 선을 그리는 중인지
  isAnyBrushDrawing: function () {
    var brushEls = this.el.sceneEl.querySelectorAll('[brush]');
    for (var i = 0; i < brushEls.length; i++) {
      var brush = brushEls[i].components.brush;
      if (brush && brush.active) { return true; }
    }
    return false;
  },

  undo: function (time) {
    this.lastUndoTime = time;
    this.state.undoCount++;
    this.state.lastResult = 'undo';
    if (this.data.target) { this.data.target.emit('undo'); }
    if (this.data.debug) { console.log('hand-undo', this.data.hand); }
  }
});
