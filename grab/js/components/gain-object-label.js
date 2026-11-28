// 손 레이로 가리키거나 멀리 잡은 물체 위에 거리와 배율을 띄운다.
//   가리킬 때:  "2.0 m"
//   잡았을 때:  "4.1 m · 배율 3.6배" / "이동 +0.58 m · 손 +12.0 cm"
// 잡는 동안에는 잡은 순간의 위치에 반투명 상자(시작 위치)를 남기고 지금 위치까지 선으로 잇는다.
AFRAME.registerComponent("gain-object-label", {
  schema: {
    baseScale: { default: 0.5 }, // 카메라에서 1 m일 때 크기 배율 (멀수록 커져서 화면에서 비슷하게 보임)
  },

  init: function () {
    var C = GainTest.COLORS;
    this.panel = new GainTest.CanvasPanel(0.6, 0.2, 600);
    this.panel.mesh.visible = false;
    this.panel.mesh.renderOrder = 10;
    this.panel.mesh.material.depthTest = false; // 물체나 다른 것에 가려지지 않게
    this.el.sceneEl.object3D.add(this.panel.mesh);

    // 시작 위치 표시 (잡을 때 물체 크기에 맞춰 만든다)
    this.ghost = new THREE.Group();
    this.ghost.visible = false;
    this.ghostFill = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: C.teal, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    this.ghostEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: C.teal }),
    );
    this.ghost.add(this.ghostFill, this.ghostEdges);
    this.el.sceneEl.object3D.add(this.ghost);

    this.lineGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.line = new THREE.Line(this.lineGeometry, new THREE.LineBasicMaterial({ color: C.teal }));
    this.line.visible = false;
    this.line.frustumCulled = false;
    this.el.sceneEl.object3D.add(this.line);

    this.box = new THREE.Box3();
    this.size = new THREE.Vector3();
    this.center = new THREE.Vector3();
    this.cameraPosition = new THREE.Vector3();
    this.ghostTarget = null; // 지금 시작 위치를 보여 주는 물체

    var self = this;
    this.onGrabStart = function (event) {
      self.showGhost(event.detail.el);
    };
    this.el.sceneEl.addEventListener("gaingrabstart", this.onGrabStart);
  },

  showGhost: function (target) {
    this.box.setFromObject(target.object3D);
    this.box.getSize(this.size);
    this.box.getCenter(this.center);
    this.ghost.scale.copy(this.size);
    this.ghost.position.copy(this.center);
    this.ghost.visible = true;
    this.ghostTarget = target;
  },

  hideGhost: function () {
    this.ghost.visible = false;
    this.line.visible = false;
    this.ghostTarget = null;
  },

  tick: function () {
    var sceneEl = this.el.sceneEl;
    var camera = sceneEl.camera;
    var state = GainTest.getActiveGainState(sceneEl);
    var target = state && (state.holding ? state.heldEl : state.hoverEl);
    if (!state || !target || !camera) {
      this.panel.mesh.visible = false;
      this.hideGhost();
      return;
    }

    if (!state.holding || this.ghostTarget !== target) this.hideGhost();
    if (state.holding && !this.ghostTarget) this.showGhost(target);

    // 라벨: 물체 위쪽, 카메라를 바라보게
    this.box.setFromObject(target.object3D);
    this.box.getCenter(this.center);
    camera.getWorldPosition(this.cameraPosition);
    var cameraDistance = this.cameraPosition.distanceTo(this.center);
    var scale = this.data.baseScale * Math.max(1, cameraDistance);
    var mesh = this.panel.mesh;
    mesh.position.set(this.center.x, this.box.max.y + 0.12 * scale + 0.05, this.center.z);
    mesh.scale.setScalar(scale);
    mesh.lookAt(this.cameraPosition);
    mesh.visible = true;

    if (state.holding) {
      this.lineGeometry.attributes.position.setXYZ(0, this.ghost.position.x, this.ghost.position.y, this.ghost.position.z);
      this.lineGeometry.attributes.position.setXYZ(1, this.center.x, this.center.y, this.center.z);
      this.lineGeometry.attributes.position.needsUpdate = true;
      this.line.visible = true;
    }

    this.drawLabel(state);
  },

  drawLabel: function (state) {
    var C = GainTest.COLORS;
    var holding = state.holding;
    var distance = holding ? state.shoulderDistance : state.hoverDistance;
    var line1 = distance.toFixed(1) + " m";
    var line2 = "";
    if (holding) {
      line1 += " · 배율 " + state.gain.toFixed(1) + "배";
      line2 =
        "이동 " + GainTest.signed(state.objectMoved, 2) + " m · 손 " +
        GainTest.signed(state.handNet * 100, 1) + " cm";
    }
    var gainT = (state.gain - 1) / 5;
    this.panel.draw(line1 + "|" + line2, function (ctx, w, h) {
      GainTest.roundRect(ctx, 4, 4, w - 8, h - 8, 36, "rgba(26,29,58,0.85)");
      if (holding) {
        // 왼쪽 띠: 지금 배율 색 (발표 자료 히트맵과 같은 색)
        GainTest.roundRect(ctx, 18, 18, 22, h - 36, 11, GainTest.heatColor(gainT));
      }
      ctx.fillStyle = C.white;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (line2) {
        GainTest.font(ctx, 62, true);
        ctx.fillText(line1, w / 2 + 12, h * 0.36);
        GainTest.font(ctx, 42, false);
        ctx.fillStyle = "#D5D9E8";
        ctx.fillText(line2, w / 2 + 12, h * 0.73);
      } else {
        GainTest.font(ctx, 84, true);
        ctx.fillText(line1, w / 2, h / 2);
      }
    }, 80);
  },

  remove: function () {
    this.el.sceneEl.removeEventListener("gaingrabstart", this.onGrabStart);
    this.panel.dispose();
    this.ghost.removeFromParent();
    this.line.removeFromParent();
  },
});
