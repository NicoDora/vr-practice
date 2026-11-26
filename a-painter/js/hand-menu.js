/* global AFRAME THREE */
// 왼손 손바닥을 위로 펴면 A-Painter 메뉴(색, 브러시, 굵기)를 손바닥 위에 띄운다.
// 오른손을 메뉴 쪽으로 향하면 레이가 나오고, 핀치하면 버튼이 눌린다.
//
// 레이는 Quest 홈 메뉴처럼 어깨에서 핀치 지점을 지나는 방향으로 쏜다.
// 손목을 꺾지 않고 손 위치만 옮겨서 겨눌 수 있고, 핀치할 때 손가락이 움직여도 레이가 거의 흔들리지 않는다.
// 손 메뉴에서는 SAVE(외부 서버로 그림 업로드)와 COPY를 숨기고 눌리지 않게 한다. (핀치로 실수로 누르기 쉬움)
//
// A-Painter 메뉴(ui 컴포넌트)는 원래 컨트롤러용이다.
//   - 메뉴를 든 손 엔티티(ui)에 다른 손 엔티티(ui)의 레이가 닿으면, 그 손이 보내는 triggerchanged로 버튼을 누른다.
//   - 이 컴포넌트를 붙인 엔티티가 "메뉴를 든 손" 역할을 하며 왼손 손바닥을 따라다닌다.
//   - 오른손 브러시 엔티티(#right-pinch-brush)에도 ui를 붙여 "레이를 쏘는 손" 역할을 하게 하고,
//     hand-paint가 핀치 시작·끝에 triggerchanged를 보낸다.
AFRAME.registerComponent('hand-menu', {
  dependencies: ['brush', 'ui'],

  schema: {
    hand: { default: 'left', oneOf: ['left', 'right'] },
    pointer: { type: 'selector', default: '#right-pinch-brush' }, // 레이를 쏘고 핀치로 누르는 손

    openThreshold: { default: 0.6 }, // 손바닥 방향의 위쪽 성분이 이보다 크면 메뉴를 연다.
    closeThreshold: { default: 0.3 }, // 이보다 작아지면 닫는다. (경계에서 깜빡이지 않게 여는 값보다 낮게)
    palmOffset: { default: 0.1 }, // m, 손바닥에서 메뉴까지 높이
    rayDistance: { default: 0.6 }, // m, 핀치 지점부터 레이 길이
    // 어깨 위치 추정값 (m, 머리 기준. 머리가 좌우로 돌아간 방향만 따라감)
    shoulderOffset: { type: 'vec3', default: { x: 0.18, y: -0.2, z: 0.05 } }, // 오른쪽 어깨 기준 (왼손이면 x 반대)
    blockedButtons: { type: 'array', default: ['save', 'copy'] },
    minHandSize: { default: 0.05 }, // m, 손목~검지 끝이 이보다 짧으면 추적이 끊긴 것으로 봄
    lostTrackingTimeout: { default: 300 } // ms, 왼손 추적이 이 시간 이상 끊기면 메뉴를 닫는다.
  },

  init: function () {
    this.wristPosition = new THREE.Vector3();
    this.wristQuaternion = new THREE.Quaternion();
    this.middleBase = new THREE.Vector3();
    this.indexTip = new THREE.Vector3();
    this.palmNormal = new THREE.Vector3();
    this.menuPosition = new THREE.Vector3();
    this.headPosition = new THREE.Vector3();
    this.headQuaternion = new THREE.Quaternion();
    this.headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.shoulder = new THREE.Vector3();
    this.blockedHidden = false;
    this.lostTime = 0;
    this.isOpen = false;
    this.state = { tracked: false, palmY: 0, open: false };

    // 컨트롤러용 기본값(레이 45도 기울임, 20cm)을 손에 맞게 바꾼다.
    var ui = this.el.components.ui;
    ui.rayAngle = 0;
    ui.rayDistance = this.data.rayDistance;
    // 메뉴 모델은 컨트롤러 위에 눕혀 놓도록 만들어져 있어서, 세워서 앞면(+Y)이 사용자 쪽(+Z)을 보게 한다.
    ui.uiEl.setAttribute('position', '0 0 0');
    ui.uiEl.setAttribute('rotation', '90 0 0');

    var self = this;
    var pointer = this.data.pointer;
    if (pointer) {
      pointer.setAttribute('ui-raycaster', { far: this.data.rayDistance });
      // 오른손이 메뉴에 닿았는지 검사하는 레이를 어깨→핀치 지점 방향으로 바꾼다.
      var pointerRaycaster = pointer.components['ui-raycaster'];
      pointerRaycaster.updateOriginDirection = function () {
        self.getPointerRay(this.raycaster);
      };
    }
    // 메뉴 버튼을 고르는 레이도 같은 방향으로 바꾼다.
    ui.updateRaycaster = function (raycaster) {
      self.getPointerRay(raycaster);
    };
    // 막아 둔 버튼은 레이에 걸리지 않은 것으로 처리한다. (강조 표시도, 누르기도 안 됨)
    var originalUpdateIntersections = ui.updateIntersections;
    var blocked = this.data.blockedButtons;
    ui.updateIntersections = function () {
      originalUpdateIntersections.apply(this, arguments);
      this.intersectedObjects = this.intersectedObjects.filter(function (hit) {
        return blocked.indexOf(hit.object.name) === -1;
      });
    };
  },

  // 어깨에서 핀치 지점을 지나는 레이를 raycaster에 넣는다. 레이는 핀치 지점에서 시작한다.
  getPointerRay: (function () {
    var direction = new THREE.Vector3();
    var origin = new THREE.Vector3();
    return function (raycaster) {
      var pointer = this.data.pointer;
      var camera = this.el.sceneEl.camera;
      if (!pointer || !camera) { return; }
      pointer.object3D.updateMatrixWorld();
      pointer.object3D.getWorldPosition(origin);

      // 머리 위치에서 좌우 회전(yaw)만 반영해 어깨를 추정한다. (고개를 숙여도 어깨는 그대로)
      camera.getWorldPosition(this.headPosition);
      camera.getWorldQuaternion(this.headQuaternion);
      this.headEuler.setFromQuaternion(this.headQuaternion, 'YXZ');
      var offset = this.data.shoulderOffset;
      var side = this.data.hand === 'left' ? 1 : -1; // 메뉴가 왼손이면 레이는 오른손
      this.shoulder.set(offset.x * side, offset.y, offset.z)
        .applyAxisAngle(THREE.Object3D.DefaultUp, this.headEuler.y)
        .add(this.headPosition);

      direction.copy(origin).sub(this.shoulder).normalize();
      raycaster.far = this.data.rayDistance;
      raycaster.set(origin, direction);
    };
  })(),

  // 메뉴 모델이 불러와진 뒤 막아 둔 버튼을 숨긴다.
  hideBlockedButtons: function () {
    var ui = this.el.components.ui;
    var mesh = ui.uiEl.getObject3D('mesh');
    if (this.blockedHidden || !ui.objects || !mesh) { return; }
    this.data.blockedButtons.forEach(function (name) {
      var object = mesh.getObjectByName(name);
      if (object) { object.visible = false; }
    });
    this.blockedHidden = true;
  },

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
    var wrist = frame.getJointPose(hand.get('wrist'), referenceSpace);
    var middle = frame.getJointPose(hand.get('middle-finger-phalanx-proximal'), referenceSpace);
    var index = frame.getJointPose(hand.get('index-finger-tip'), referenceSpace);
    if (!wrist || !middle || !index) { return false; }

    this.wristPosition.copy(wrist.transform.position);
    this.wristQuaternion.copy(wrist.transform.orientation);
    this.middleBase.copy(middle.transform.position);
    this.indexTip.copy(index.transform.position);
    if (this.wristPosition.distanceTo(this.indexTip) < this.data.minHandSize) { return false; }
    return true;
  },

  open: function () {
    if (this.isOpen) { return; }
    var ui = this.el.components.ui;
    ui.system.closeAll();
    ui.open();
    ui.system.opened = this.el; // 오른손 레이를 보이게 하는 조건
    this.isOpen = true;
    this.el.sceneEl.addState('hand-menu-open');
  },

  close: function () {
    if (!this.isOpen) { return; }
    var ui = this.el.components.ui;
    ui.close();
    if (ui.system.opened === this.el) { ui.system.opened = undefined; }
    this.isOpen = false;
    this.el.sceneEl.removeState('hand-menu-open');
  },

  remove: function () {
    this.close();
  },

  tick: function (time, timeDelta) {
    var data = this.data;
    this.hideBlockedButtons();
    var tracked = this.readJoints();
    this.state.tracked = tracked;
    if (!tracked) {
      this.lostTime += timeDelta;
      if (this.lostTime > data.lostTrackingTimeout) { this.close(); }
      this.state.open = this.isOpen;
      return;
    }
    this.lostTime = 0;

    // WebXR 관절의 -Y 방향이 손바닥이 향하는 방향이다.
    this.palmNormal.set(0, -1, 0).applyQuaternion(this.wristQuaternion);
    var palmY = this.palmNormal.y;
    this.state.palmY = palmY;

    if (!this.isOpen && palmY > data.openThreshold) {
      this.open();
    } else if (this.isOpen && palmY < data.closeThreshold) {
      this.close();
    }

    // 손바닥 가운데(손목과 중지 뿌리 사이)에서 손바닥 방향으로 띄우고, 머리 쪽을 바라보게 한다.
    var object3D = this.el.object3D;
    this.menuPosition.copy(this.wristPosition).lerp(this.middleBase, 0.5)
      .addScaledVector(this.palmNormal, data.palmOffset);
    object3D.position.copy(this.menuPosition);
    var camera = this.el.sceneEl.camera;
    if (camera) {
      camera.getWorldPosition(this.headPosition);
      object3D.parent.worldToLocal(this.headPosition);
      object3D.lookAt(this.headPosition);
    }
    this.state.open = this.isOpen;
  }
});
