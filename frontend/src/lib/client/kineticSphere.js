export const initKineticSphere = async (canvas) => {
	if (!canvas || typeof window === 'undefined') return () => {};

	let THREE;
	try {
		THREE = await import('three');
	} catch {
		return () => {};
	}

	const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
	camera.position.set(0, 0, 4.6);

	const renderer = new THREE.WebGLRenderer({
		canvas,
		alpha: true,
		antialias: true,
		powerPreference: 'high-performance'
	});
	renderer.setClearColor(0x000000, 0);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	const geometries = [];
	const materials = [];
	const textures = [];

	const makeRadialTexture = (size, stops) => {
		const source = document.createElement('canvas');
		source.width = source.height = size;
		const ctx = source.getContext('2d');
		if (!ctx) return null;
		const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
		for (const [offset, color] of stops) gradient.addColorStop(offset, color);
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, size, size);
		const texture = new THREE.CanvasTexture(source);
		texture.colorSpace = THREE.SRGBColorSpace;
		textures.push(texture);
		return texture;
	};

	const dotTexture = makeRadialTexture(64, [
		[0, 'rgba(255,255,255,1)'],
		[0.28, 'rgba(255,255,255,0.9)'],
		[0.72, 'rgba(160,230,244,0.34)'],
		[1, 'rgba(255,255,255,0)']
	]);
	const haloTexture = makeRadialTexture(256, [
		[0, 'rgba(156,226,240,0.28)'],
		[0.42, 'rgba(121,210,230,0.15)'],
		[0.74, 'rgba(121,210,230,0.05)'],
		[1, 'rgba(121,210,230,0)']
	]);

	const group = new THREE.Group();
	group.rotation.set(0.26, -0.16, 0.04);
	scene.add(group);

	if (haloTexture) {
		const haloMaterial = new THREE.SpriteMaterial({
			map: haloTexture,
			transparent: true,
			opacity: 0.85,
			depthWrite: false,
			depthTest: false,
			blending: THREE.AdditiveBlending
		});
		materials.push(haloMaterial);
		const halo = new THREE.Sprite(haloMaterial);
		halo.scale.set(3.65, 3.65, 1);
		halo.renderOrder = 0;
		scene.add(halo);
	}

	const radius = 1.34;
	const count = 1650;
	const positions = new Float32Array(count * 3);
	const colors = new Float32Array(count * 3);
	const warm = new THREE.Color(0xffead1);
	const cool = new THREE.Color(0x91dceb);
	const rim = new THREE.Color(0xf4fdff);
	const golden = Math.PI * (3 - Math.sqrt(5));

	for (let i = 0; i < count; i += 1) {
		const y = 1 - (i / (count - 1)) * 2;
		const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
		const theta = golden * i;
		const x = Math.cos(theta) * ringRadius;
		const z = Math.sin(theta) * ringRadius;
		const colorMix = (y + 1) / 2;
		const edge = Math.pow(Math.abs(x), 2.2) * 0.34 + Math.pow(Math.max(0, -z), 2) * 0.22;
		const color = cool
			.clone()
			.lerp(warm, colorMix * 0.78 + 0.1)
			.lerp(rim, Math.min(0.34, edge));

		positions[i * 3] = x * radius;
		positions[i * 3 + 1] = y * radius;
		positions[i * 3 + 2] = z * radius;
		colors[i * 3] = color.r;
		colors[i * 3 + 1] = color.g;
		colors[i * 3 + 2] = color.b;
	}

	const pointGeometry = new THREE.BufferGeometry();
	pointGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	pointGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geometries.push(pointGeometry);

	const pointMaterial = new THREE.PointsMaterial({
		size: 0.043,
		map: dotTexture || undefined,
		vertexColors: true,
		transparent: true,
		opacity: 0.9,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		sizeAttenuation: true
	});
	materials.push(pointMaterial);
	const points = new THREE.Points(pointGeometry, pointMaterial);
	points.renderOrder = 2;
	group.add(points);

	const shellGeometry = new THREE.SphereGeometry(radius * 1.012, 64, 32);
	geometries.push(shellGeometry);
	const shellMaterial = new THREE.MeshBasicMaterial({
		color: 0x79d2e6,
		transparent: true,
		opacity: 0.045,
		depthWrite: false,
		blending: THREE.AdditiveBlending
	});
	materials.push(shellMaterial);
	const shell = new THREE.Mesh(shellGeometry, shellMaterial);
	shell.renderOrder = 1;
	group.add(shell);

	const createLoop = (buildPoint, opacity, color = 0xbfeaf2) => {
		const segments = 192;
		const vertices = [];
		for (let i = 0; i < segments; i += 1) {
			vertices.push(buildPoint((i / segments) * Math.PI * 2));
		}
		const geometry = new THREE.BufferGeometry().setFromPoints(vertices);
		geometries.push(geometry);
		const material = new THREE.LineBasicMaterial({
			color,
			transparent: true,
			opacity,
			depthWrite: false,
			blending: THREE.AdditiveBlending
		});
		materials.push(material);
		const line = new THREE.LineLoop(geometry, material);
		line.renderOrder = 3;
		return line;
	};

	for (const y of [-0.74, -0.37, 0, 0.37, 0.74]) {
		const lineRadius = Math.sqrt(Math.max(0, radius * radius - y * y));
		group.add(
			createLoop(
				(angle) => new THREE.Vector3(Math.cos(angle) * lineRadius, y, Math.sin(angle) * lineRadius),
				y === 0 ? 0.2 : 0.12
			)
		);
	}

	for (const [index, rotation] of [0, Math.PI / 4, Math.PI / 2, (Math.PI * 3) / 4].entries()) {
		const meridian = createLoop(
			(angle) => new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0),
			index === 0 ? 0.18 : 0.12,
			index === 0 ? 0xd7f7fb : 0xbfeaf2
		);
		meridian.rotation.y = rotation;
		group.add(meridian);
	}

	const resize = () => {
		const rect = canvas.getBoundingClientRect();
		const width = Math.max(1, Math.round(rect.width || canvas.clientWidth || 1));
		const height = Math.max(1, Math.round(rect.height || canvas.clientHeight || width));
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
	};
	resize();

	let resizeObserver = null;
	if ('ResizeObserver' in window) {
		resizeObserver = new ResizeObserver(resize);
		resizeObserver.observe(canvas);
	} else {
		window.addEventListener('resize', resize);
	}

	const render = () => renderer.render(scene, camera);
	const dispose = () => {
		resizeObserver?.disconnect();
		if (!resizeObserver) window.removeEventListener('resize', resize);
		for (const geometry of geometries) geometry.dispose();
		for (const material of materials) material.dispose();
		for (const texture of textures) texture.dispose();
		renderer.dispose();
	};

	if (reduceMotion) {
		group.rotation.y = 0.34;
		render();
		return dispose;
	}

	let rafId = 0;
	let running = false;
	let last = performance.now();

	const tick = (now) => {
		const delta = Math.min(0.05, (now - last) / 1000);
		last = now;
		group.rotation.y += delta * 0.18;
		group.rotation.x = 0.26 + Math.sin(now * 0.00022) * 0.045;
		render();
		rafId = window.requestAnimationFrame(tick);
	};

	const start = () => {
		if (running) return;
		running = true;
		last = performance.now();
		rafId = window.requestAnimationFrame(tick);
	};

	const stop = () => {
		running = false;
		if (rafId) window.cancelAnimationFrame(rafId);
		rafId = 0;
	};

	let intersectionObserver = null;
	if ('IntersectionObserver' in window) {
		intersectionObserver = new IntersectionObserver(
			(entries) => (entries.some((entry) => entry.isIntersecting) ? start() : stop()),
			{ rootMargin: '160px' }
		);
		intersectionObserver.observe(canvas);
	} else {
		start();
	}

	return () => {
		stop();
		intersectionObserver?.disconnect();
		dispose();
	};
};
