// Pull/Push 배율 테스트 패널
//   - 모드 버튼: 가변 배율(속도 계수 × 거리 계수) ↔ 고정 4배(2주차 방식)
//   - "물체를 2 m에" / "물체를 6 m에": 마지막으로 잡은 물체를 어깨에서 그 거리에 놓는다. (측정 조건 맞추기)
//   - 마지막 잡기 결과: 손 이동 → 물체 이동, 실제 배율
// 버튼은 손 레이로 가리키고 핀치하면 눌린다. (hand-grabber가 handpress를 보냄) PC에서는 마우스 클릭.
AFRAME.registerComponent("gain-panel", {
  schema: {
    defaultTarget: { type: "selector", default: "#box1" },
  },

  init: function () {
    var self = this;
    var sceneEl = this.el.sceneEl;
    this.W = 1000; // px
    this.H = 800; // px
    this.panel = new GainTest.CanvasPanel(1.0, 0.8, this.W);
    this.el.setObject3D("panel", this.panel.mesh);

    this.hovered = {}; // action → 가리키는 cursor 목록
    this.message = "";
    this.messageUntil = 0;
    this.lastTarget = null;

    // 캔버스 위 버튼 영역 (px)
    this.buttons = [
      { action: "toggle", x: 40, y: 110, w: 920, h: 150 },
      { action: "place2", x: 40, y: 290, w: 450, h: 100, distance: 2 },
      { action: "place6", x: 510, y: 290, w: 450, h: 100, distance: 6 },
    ];
    // 레이와 마우스가 맞힐 수 있도록 버튼마다 투명한 평면을 만든다.
    this.buttons.forEach(function (button) {
      var buttonEl = document.createElement("a-entity");
      buttonEl.classList.add("hand-button");
      buttonEl.setAttribute("geometry", {
        primitive: "plane",
        width: button.w / self.W,
        height: button.h / self.W,
      });
      buttonEl.setAttribute("material", { transparent: true, opacity: 0, depthWrite: false });
      buttonEl.setAttribute("position", {
        x: (button.x + button.w / 2) / self.W - 0.5,
        y: 0.4 - (button.y + button.h / 2) / self.W,
        z: 0.005,
      });
      buttonEl.addEventListener("handpress", function () {
        self.press(button);
      });
      // click은 PC 마우스(씬의 cursor)에서 온 것만 받는다.
      // VR에서는 손 핀치가 WebXR select 이벤트도 보내서 손 cursor가 뗄 때 click을 한 번 더 보내기 때문
      // (핀치는 hand-grabber가 보내는 handpress로 이미 처리함)
      buttonEl.addEventListener("click", function (event) {
        if (event.detail && event.detail.cursorEl !== self.el.sceneEl) return;
        self.press(button);
      });
      buttonEl.addEventListener("mouseenter", function (event) {
        self.setHover(button.action, event.detail && event.detail.cursorEl, true);
      });
      buttonEl.addEventListener("mouseleave", function (event) {
        self.setHover(button.action, event.detail && event.detail.cursorEl, false);
      });
      self.el.appendChild(buttonEl);
    });

    this.onGrabStart = function (event) {
      self.lastTarget = event.detail.el;
    };
    sceneEl.addEventListener("gaingrabstart", this.onGrabStart);

    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.headPosition = new THREE.Vector3();
    this.box = new THREE.Box3();
    this.size = new THREE.Vector3();
    this.center = new THREE.Vector3();
    this.targetPosition = new THREE.Vector3();
  },

  getMode: function () {
    var hand = this.el.sceneEl.querySelector("[hand-grabber]");
    return hand ? hand.getAttribute("hand-grabber").gainMode : "adaptive";
  },

  setHover: function (action, cursorEl, on) {
    var list = this.hovered[action] || (this.hovered[action] = []);
    var index = list.indexOf(cursorEl);
    if (on && index === -1) list.push(cursorEl);
    if (!on && index !== -1) list.splice(index, 1);
  },

  showMessage: function (text) {
    this.message = text;
    this.messageUntil = performance.now() + 2500;
  },

  press: function (button) {
    var sceneEl = this.el.sceneEl;
    // 잡는 도중에 배율이나 위치가 바뀌면 측정값이 섞이므로 막는다.
    if (GainTest.isAnyHandHolding(sceneEl)) {
      this.showMessage("잡은 물체를 놓고 누르세요");
      return;
    }
    if (button.action === "toggle") {
      var next = this.getMode() === "fixed" ? "adaptive" : "fixed";
      sceneEl.querySelectorAll("[hand-grabber]").forEach(function (hand) {
        hand.setAttribute("hand-grabber", "gainMode", next);
      });
      console.log("gain mode", next);
      this.showMessage(next === "fixed" ? "고정 4배로 바꿈" : "가변 배율로 바꿈");
      return;
    }
    this.placeTarget(button.distance);
  },

  // 물체 앞면이 어깨에서 distance m가 되도록, 바닥 눈금이 그려진 정면(rig의 -Z) 방향에 놓는다.
  // (버튼을 누를 때는 패널을 보고 있으므로 머리 방향이 아니라 정면 기준으로 놓는다)
  // 다른 물체는 겹치지 않게 같은 거리에서 오른쪽으로 비켜 놓는다.
  placeTarget: function (distance) {
    var sceneEl = this.el.sceneEl;
    var camera = sceneEl.camera;
    if (!camera) return;
    var target = this.lastTarget || this.data.defaultTarget;
    if (!target) return;

    camera.getWorldPosition(this.headPosition);
    var rig = camera.el.parentEl ? camera.el.parentEl.object3D : sceneEl.object3D;
    this.forward.set(0, 0, -1).transformDirection(rig.matrixWorld);
    this.forward.y = 0;
    this.forward.normalize();
    this.right.set(-this.forward.z, 0, this.forward.x);
    var shoulderY = this.headPosition.y - 0.15; // hand-grabber의 추정 어깨 높이와 같게

    var self = this;
    var others = Array.prototype.filter.call(sceneEl.querySelectorAll(".grabbable"), function (el) {
      return el !== target && !el.is("grabbed");
    });
    [target].concat(others).forEach(function (el, i) {
      self.box.setFromObject(el.object3D);
      self.box.getSize(self.size);
      self.box.getCenter(self.center);
      var halfDepth = (self.size.x + self.size.z) / 4;
      var dy = self.center.y - shoulderY;
      var horizontal = Math.sqrt(Math.max(distance * distance - dy * dy, 0.25)) + halfDepth;
      var side = i * 1.4; // 다른 물체는 1.4 m씩 오른쪽으로
      self.targetPosition
        .copy(self.headPosition)
        .addScaledVector(self.forward, horizontal)
        .addScaledVector(self.right, side);
      // 물체 중심 높이는 그대로 두고, 오브젝트 원점과 중심의 차이를 반영한다.
      var object3D = el.object3D;
      object3D.updateWorldMatrix(true, false);
      var worldOrigin = new THREE.Vector3().setFromMatrixPosition(object3D.matrixWorld);
      self.targetPosition.y = self.center.y;
      self.targetPosition.add(worldOrigin.sub(self.center));
      if (object3D.parent) object3D.parent.worldToLocal(self.targetPosition);
      object3D.position.copy(self.targetPosition);
    });
    console.log("gain place", target.id, distance + " m");
    this.showMessage((target.id || "물체") + " → " + distance + " m에 놓음");
  },

  tick: function () {
    var mode = this.getMode();
    var log = window.gainLog || [];
    var result = log.length ? log[log.length - 1] : null;
    var now = performance.now();
    var message = now < this.messageUntil ? this.message : "";
    var hover = this.buttons
      .map(function (b) {
        return this.hovered[b.action] && this.hovered[b.action].length ? b.action : "";
      }, this)
      .join("");
    var key = [mode, hover, message, log.length].join("|");
    var buttons = this.buttons;
    var C = GainTest.COLORS;

    this.panel.draw(key, function (ctx, w, h) {
      var fixed = mode === "fixed";
      GainTest.roundRect(ctx, 0, 0, w, h, 40, "rgba(26,29,58,0.92)");

      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      GainTest.font(ctx, 44, true);
      ctx.fillStyle = C.white;
      ctx.fillText("Pull/Push 배율 테스트", 40, 60);
      GainTest.font(ctx, 28, false);
      ctx.fillStyle = C.muted;
      ctx.textAlign = "right";
      ctx.fillText("레이로 가리키고 핀치", w - 40, 60);

      buttons.forEach(function (b) {
        var isHover = hover.indexOf(b.action) !== -1;
        var fill;
        if (b.action === "toggle") fill = fixed ? "#5A6280" : C.teal;
        else fill = "rgba(255,255,255,0.12)";
        GainTest.roundRect(ctx, b.x, b.y, b.w, b.h, 24, fill);
        if (isHover) {
          ctx.lineWidth = 8;
          ctx.strokeStyle = C.white;
          ctx.stroke();
        }
        ctx.fillStyle = C.white;
        ctx.textAlign = "center";
        if (b.action === "toggle") {
          GainTest.font(ctx, 56, true);
          ctx.fillText(fixed ? "모드: 고정 4배" : "모드: 가변 배율", w / 2, b.y + 58);
          GainTest.font(ctx, 30, false);
          ctx.fillStyle = "#E3E7F0";
          ctx.fillText(
            fixed ? "2주차 방식 · 누르면 가변 배율로" : "속도 계수 × 거리 계수 (1~6배) · 누르면 고정 4배로",
            w / 2,
            b.y + 112,
          );
        } else {
          GainTest.font(ctx, 40, true);
          ctx.fillText("물체를 " + b.distance + " m에", b.x + b.w / 2, b.y + b.h / 2);
        }
      });

      // 마지막 잡기 결과
      var top = 430;
      ctx.textAlign = "left";
      GainTest.font(ctx, 32, true);
      ctx.fillStyle = C.muted;
      ctx.fillText("마지막 잡기", 40, top);
      if (result) {
        ctx.textAlign = "right";
        GainTest.font(ctx, 30, false);
        ctx.fillText((result.mode === "fixed" ? "고정 4배" : "가변 배율") + " · 기록 " + log.length + "개", w - 40, top);
        ctx.textAlign = "left";
        GainTest.font(ctx, 50, true);
        ctx.fillStyle = C.white;
        ctx.fillText(
          "손 " + GainTest.signed(result.handNet * 100, 1) + " cm → 물체 " + GainTest.signed(result.objectMoved, 2) + " m",
          40,
          top + 80,
        );
        GainTest.font(ctx, 36, true);
        ctx.fillStyle = C.teal;
        ctx.fillText(
          result.effectiveGain === null ? "실제 배율 -  (손 이동 2 cm 미만)" : "실제 배율 " + result.effectiveGain.toFixed(1) + "배",
          40,
          top + 150,
        );
        GainTest.font(ctx, 30, false);
        ctx.fillStyle = "#D5D9E8";
        ctx.fillText(
          "시작 " + result.startDistance.toFixed(1) + " m → 끝 " + result.endDistance.toFixed(1) + " m · 최고 속도 " +
            result.peakSpeed.toFixed(2) + " m/s · " + (result.durationMs / 1000).toFixed(1) + "초",
          40,
          top + 210,
        );
      } else {
        GainTest.font(ctx, 34, false);
        ctx.fillStyle = "#D5D9E8";
        ctx.fillText("물체를 레이로 잡고 밀거나 당긴 뒤 놓으면 여기에 표시", 40, top + 80);
      }

      if (message) {
        GainTest.roundRect(ctx, 40, h - 100, w - 80, 70, 20, C.orange);
        ctx.fillStyle = C.white;
        ctx.textAlign = "center";
        GainTest.font(ctx, 34, true);
        ctx.fillText(message, w / 2, h - 65);
      }
    });
  },

  remove: function () {
    this.el.sceneEl.removeEventListener("gaingrabstart", this.onGrabStart);
    this.panel.dispose();
  },
});
