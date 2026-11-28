// Pull/Push 배율 테스트 화면(바닥 눈금, 물체 라벨, 손목 게이지, 패널)이 함께 쓰는 도구
//   - CanvasPanel: 캔버스에 글자를 그려 평면에 붙인다. A-Frame text 컴포넌트 글꼴은 한글이 안 나와서 직접 그린다.
//   - heatColor: 발표 자료 2.3 히트맵과 같은 색 (1배 연한 색 → 청록 → 6배 남색)
//   - getActiveGainState: 지금 물체를 잡고 있거나 가리키는 손의 배율 상태
window.GainTest = (function () {
  var FONT =
    '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK KR", sans-serif';

  var COLORS = {
    navy: "#1A1D3A",
    teal: "#2BA7C4",
    tint: "#EEF3F8",
    sub: "#4A5070",
    muted: "#9AA3B8",
    white: "#FFFFFF",
    orange: "#E8833A",
  };

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mix(a, b, t) {
    var ca = hexToRgb(a);
    var cb = hexToRgb(b);
    var c = ca.map(function (v, i) {
      return Math.round(v + (cb[i] - v) * t);
    });
    return "rgb(" + c.join(",") + ")";
  }

  // t: 0~1 (0 = 최소 배율, 1 = 최대 배율)
  function heatColor(t) {
    t = Math.min(1, Math.max(0, t));
    return t < 0.5
      ? mix(COLORS.tint, COLORS.teal, t / 0.5)
      : mix(COLORS.teal, COLORS.navy, (t - 0.5) / 0.5);
  }

  // widthM × heightM 크기 평면, 가로 pixelWidth 픽셀 캔버스
  function CanvasPanel(widthM, heightM, pixelWidth) {
    this.width = pixelWidth;
    this.height = Math.round((pixelWidth * heightM) / widthM);
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext("2d");
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(widthM, heightM),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
    this.lastKey = null;
  }

  // key가 지난번과 같으면 다시 그리지 않는다. (매 프레임 텍스처를 올리지 않게)
  // minInterval(ms)을 주면 값이 계속 바뀌어도 그 간격보다 자주 그리지 않는다.
  CanvasPanel.prototype.draw = function (key, drawFn, minInterval) {
    if (key === this.lastKey) return;
    var now = performance.now();
    if (minInterval && now - (this.lastDrawTime || 0) < minInterval) return;
    this.lastDrawTime = now;
    this.lastKey = key;
    this.ctx.clearRect(0, 0, this.width, this.height);
    drawFn(this.ctx, this.width, this.height);
    this.texture.needsUpdate = true;
  };

  CanvasPanel.prototype.dispose = function () {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
  };

  function font(ctx, sizePx, bold) {
    ctx.font = (bold ? "700 " : "400 ") + sizePx + "px " + FONT;
  }

  function roundRect(ctx, x, y, w, h, r, fill) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // 물체를 잡고 있는 손이 우선, 없으면 물체를 가리키는 손, 둘 다 없으면 null
  function getActiveGainState(sceneEl) {
    var hands = sceneEl.querySelectorAll("[hand-grabber]");
    var hovering = null;
    for (var i = 0; i < hands.length; i++) {
      var component = hands[i].components["hand-grabber"];
      if (!component || !component.gainState) continue;
      if (component.gainState.holding) return component.gainState;
      if (!hovering && component.gainState.hoverEl) hovering = component.gainState;
    }
    return hovering;
  }

  function isAnyHandHolding(sceneEl) {
    var hands = sceneEl.querySelectorAll("[hand-grabber]");
    for (var i = 0; i < hands.length; i++) {
      var component = hands[i].components["hand-grabber"];
      if (component && component.gainState && component.gainState.holding) return true;
    }
    return false;
  }

  function signed(value, digits) {
    return (value >= 0 ? "+" : "") + value.toFixed(digits);
  }

  return {
    COLORS: COLORS,
    heatColor: heatColor,
    CanvasPanel: CanvasPanel,
    font: font,
    roundRect: roundRect,
    getActiveGainState: getActiveGainState,
    isAnyHandHolding: isAnyHandHolding,
    signed: signed,
  };
})();
