// 손목 위에 속도 계수, 거리 계수, 배율 막대를 띄운다. (손목시계처럼 보면 되는 위치)
// hand-tracking-controls가 붙은 손 엔티티에 붙인다. 보통 왼손에 두고 오른손으로 잡는다.
// 고정 4배 모드에서는 계수 막대를 회색으로, 배율 막대는 4배로 보여 준다.
AFRAME.registerComponent("gain-wrist-gauge", {
  schema: {
    height: { default: 0.08 }, // m, 손목에서 위로 띄우는 높이
  },

  init: function () {
    this.panel = new GainTest.CanvasPanel(0.16, 0.1, 640);
    this.panel.mesh.visible = false;
    this.el.sceneEl.object3D.add(this.panel.mesh);
    this.jointMatrix = new THREE.Matrix4();
    this.wristPosition = new THREE.Vector3();
    this.cameraPosition = new THREE.Vector3();
  },

  tick: function () {
    var handControls = this.el.components["hand-tracking-controls"];
    var camera = this.el.sceneEl.camera;
    var mesh = this.panel.mesh;
    if (!handControls || !handControls.hasPoses || !camera) {
      mesh.visible = false;
      return;
    }

    // 관절 좌표는 손 엔티티(rig) 기준이라 월드 좌표로 바꾼다. (0번 = 손목)
    this.el.object3D.updateWorldMatrix(true, false);
    this.jointMatrix.fromArray(handControls.jointPoses, 0);
    this.wristPosition.setFromMatrixPosition(this.jointMatrix).applyMatrix4(this.el.object3D.matrixWorld);
    // 추적이 끊긴 손은 관절이 한 점에 모여 엉뚱한 곳에 보일 수 있어, 손목이 원점 근처면 숨긴다.
    if (this.wristPosition.lengthSq() < 1e-6) {
      mesh.visible = false;
      return;
    }
    mesh.position.copy(this.wristPosition);
    mesh.position.y += this.data.height;
    camera.getWorldPosition(this.cameraPosition);
    mesh.lookAt(this.cameraPosition);
    mesh.visible = true;

    this.draw(GainTest.getActiveGainState(this.el.sceneEl));
  },

  draw: function (state) {
    var C = GainTest.COLORS;
    var active = !!(state && state.holding);
    var fixed = active && state.mode === "fixed";
    var rows = [
      ["속도 계수", active ? state.speedGain : 1, 1, 3],
      ["거리 계수", active ? state.distanceGain : 1, 1, 2],
      ["배율", active ? state.gain : 1, 1, 6],
    ];
    var key = active
      ? state.mode + rows.map(function (r) { return r[1].toFixed(2); }).join(",")
      : "idle";

    this.panel.draw(key, function (ctx, w, h) {
      GainTest.roundRect(ctx, 4, 4, w - 8, h - 8, 30, "rgba(26,29,58,0.88)");
      ctx.textBaseline = "middle";
      GainTest.font(ctx, 30, true);
      ctx.fillStyle = fixed ? C.muted : C.teal;
      ctx.textAlign = "left";
      var title = !active ? "물체를 멀리 잡으면 표시" : fixed ? "고정 4배 모드" : "가변 배율 모드";
      ctx.fillText(title, 32, 44);

      var barX = 190;
      var barW = 300;
      var barH = 34;
      rows.forEach(function (row, i) {
        var label = row[0];
        var value = row[1];
        var min = row[2];
        var max = row[3];
        var y = 110 + i * 92;
        var t = (value - min) / (max - min);
        var isGain = i === 2;
        var grey = !active || (fixed && !isGain);

        GainTest.font(ctx, 32, isGain);
        ctx.fillStyle = grey ? C.muted : C.white;
        ctx.textAlign = "left";
        ctx.fillText(label, 32, y);

        GainTest.roundRect(ctx, barX, y - barH / 2, barW, barH, 10, "rgba(255,255,255,0.12)");
        if (active) {
          // 막대 색은 배율 전체(1~6배) 기준 히트맵 색. 계수 막대는 자기 범위 안에서의 비율로 칠한다.
          var fill = grey ? C.muted : GainTest.heatColor(isGain ? t : t * 0.6 + 0.2);
          GainTest.roundRect(ctx, barX, y - barH / 2, Math.max(barH, barW * Math.min(1, Math.max(0, t))), barH, 10, fill);
        }

        GainTest.font(ctx, 34, true);
        ctx.fillStyle = grey ? C.muted : C.white;
        ctx.textAlign = "right";
        ctx.fillText(active ? value.toFixed(1) + "배" : "-", w - 30, y);
      });
    }, 80);
  },

  remove: function () {
    this.panel.dispose();
  },
});
