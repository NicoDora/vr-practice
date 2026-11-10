AFRAME.registerComponent("mouse-grabbable", {
  init: function () {
    var el = this.el;
    var sceneEl = el.sceneEl;
    var material = el.getAttribute("material");
    var originalColor =
      material && material.color ? material.color : "#FFF";
    var hoverColor = "rgb(215, 123, 31)";
    var grabbed = false;
    var hovered = false;
    var lookControls = null;
    var lookControlsPaused = false;

    // Pull/Push 설정 (단위: m)
    var minDistance = 0.5;
    var maxDistance = 10;
    var wheelStep = 0.25;
    var keySpeed = 2; // Q/E를 누르고 있을 때 초당 이동 거리
    var pullKeyPressed = false;
    var pushKeyPressed = false;

    // 마우스가 움직이는 동안 카메라에서 발사할 광선과 드래그 평면
    var raycaster = new THREE.Raycaster();
    var mouse = new THREE.Vector2();
    var dragPlane = new THREE.Plane();
    var cameraDirection = new THREE.Vector3();
    var cameraWorldPosition = new THREE.Vector3();
    var objectWorldPosition = new THREE.Vector3();
    var intersectionPoint = new THREE.Vector3();
    var targetWorldPosition = new THREE.Vector3();
    var dragOffset = new THREE.Vector3();

    // 마지막 마우스 좌표에서 쏜 광선과 드래그 평면의 교점으로 오브젝트를 옮긴다.
    function updatePosition() {
      var camera = sceneEl.camera;
      camera.updateMatrixWorld(true);
      raycaster.setFromCamera(mouse, camera);

      if (!raycaster.ray.intersectPlane(dragPlane, intersectionPoint)) return;

      targetWorldPosition.copy(intersectionPoint).add(dragOffset);

      // 부모 요소가 있는 경우에도 올바른 로컬 좌표가 되도록 변환
      var parent = el.object3D.parent;
      if (parent) {
        parent.updateMatrixWorld(true);
        parent.worldToLocal(targetWorldPosition);
      }
      el.object3D.position.copy(targetWorldPosition);
    }

    // 드래그 평면을 카메라 정면 방향으로 앞뒤로 옮겨 오브젝트를 당기거나 민다.
    // delta > 0 이면 멀어지고(Push), delta < 0 이면 가까워진다(Pull).
    function moveDistance(delta) {
      if (!grabbed || !sceneEl.camera || !delta) return;

      sceneEl.camera.getWorldPosition(cameraWorldPosition);
      var currentDistance = -dragPlane.distanceToPoint(cameraWorldPosition);
      var nextDistance = THREE.MathUtils.clamp(
        currentDistance + delta,
        minDistance,
        maxDistance,
      );
      dragPlane.constant -= nextDistance - currentDistance;
      updatePosition();
    }

    this.onMouseEnter = function () {
      hovered = true;
      if (!grabbed) el.setAttribute("material", "color", hoverColor);
    };

    this.onMouseLeave = function () {
      hovered = false;
      if (!grabbed) el.setAttribute("material", "color", originalColor);
    };

    this.onMouseDown = function (event) {
      if (grabbed || !sceneEl.camera) return;

      var camera = sceneEl.camera;
      camera.updateMatrixWorld(true);
      el.object3D.updateMatrixWorld(true);
      el.object3D.getWorldPosition(objectWorldPosition);

      // 클릭한 표면을 지나는 카메라 정면 방향의 평면을 만든다.
      // 오브젝트 중심이 아닌 클릭 위치를 기준으로 오프셋을 계산해
      // 드래그를 시작할 때 오브젝트가 튀는 현상을 방지한다.
      var intersection = event.detail && event.detail.intersection;
      if (intersection && intersection.point) {
        intersectionPoint.copy(intersection.point);
      } else {
        intersectionPoint.copy(objectWorldPosition);
      }

      camera.getWorldDirection(cameraDirection);
      dragPlane.setFromNormalAndCoplanarPoint(
        cameraDirection,
        intersectionPoint,
      );
      dragOffset.copy(objectWorldPosition).sub(intersectionPoint);

      // 마우스를 움직이기 전에 휠/Q/E를 써도 되도록 클릭 지점의 화면 좌표를 저장
      targetWorldPosition.copy(intersectionPoint).project(camera);
      mouse.set(targetWorldPosition.x, targetWorldPosition.y);

      grabbed = true;
      console.log("grab", el.id);
      el.setAttribute("material", "color", "#EF2D5E");

      // 드래그 중 마우스 이동이 카메라 회전과 겹치지 않도록 한다.
      var cameraEl = camera.el || sceneEl.querySelector("[camera]");
      lookControls = cameraEl && cameraEl.components["look-controls"];
      if (lookControls && lookControls.isPlaying) {
        lookControls.pause();
        lookControlsPaused = true;
      }
    };

    this.onMouseMove = function (event) {
      if (!grabbed || !sceneEl.camera || !sceneEl.canvas) return;

      var rect = sceneEl.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      // 브라우저 화면 좌표를 Three.js의 정규화 장치 좌표(-1~1)로 변환
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      updatePosition();
    };

    this.onMouseUp = function () {
      if (!grabbed) return;

      grabbed = false;
      console.log("release", el.id);
      el.setAttribute(
        "material",
        "color",
        hovered ? hoverColor : originalColor,
      );

      if (lookControlsPaused && lookControls) {
        lookControls.play();
      }
      lookControls = null;
      lookControlsPaused = false;
    };

    this.onWheel = function (event) {
      if (!grabbed) return;

      // 잡고 있는 동안에는 페이지 스크롤을 막는다.
      event.preventDefault();

      // 마우스 휠과 트랙패드의 deltaY 크기가 크게 달라 방향만 사용한다.
      // 휠을 위로(앞으로) 굴리면 Push, 아래로 굴리면 Pull
      moveDistance(-Math.sign(event.deltaY) * wheelStep);
    };

    // 한글 입력 상태에서도 동작하도록 event.key 대신 물리 키 위치(event.code)를 사용
    this.onKeyDown = function (event) {
      if (event.code === "KeyQ") pullKeyPressed = true;
      if (event.code === "KeyE") pushKeyPressed = true;
    };

    this.onKeyUp = function (event) {
      if (event.code === "KeyQ") pullKeyPressed = false;
      if (event.code === "KeyE") pushKeyPressed = false;
    };

    this.onBlur = function () {
      pullKeyPressed = false;
      pushKeyPressed = false;
      this.onMouseUp();
    }.bind(this);

    // 키를 누르고 있는 동안 프레임 시간에 비례해 부드럽게 이동
    this.updateKeyPullPush = function (timeDelta) {
      var direction = (pushKeyPressed ? 1 : 0) - (pullKeyPressed ? 1 : 0);
      if (!direction) return;
      moveDistance(direction * keySpeed * (timeDelta / 1000));
    };

    el.addEventListener("mouseenter", this.onMouseEnter);
    el.addEventListener("mouseleave", this.onMouseLeave);
    el.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  },

  tick: function (time, timeDelta) {
    this.updateKeyPullPush(timeDelta);
  },

  remove: function () {
    this.el.removeEventListener("mouseenter", this.onMouseEnter);
    this.el.removeEventListener("mouseleave", this.onMouseLeave);
    this.el.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  },
});
