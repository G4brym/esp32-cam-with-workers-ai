function uint8ArrayToBase64(uint8Array: Uint8Array) {
	// Convert the Uint8Array into a binary string
	const binaryString = String.fromCharCode(...uint8Array);

	// Encode the binary string into a Base64 string
	return btoa(binaryString);
}

async function handleUpload(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const contentType = request.headers.get('Content-Type');

	// Ensure the request contains form-data
	if (contentType && contentType.includes('multipart/form-data')) {
		const formData = await request.formData();
		const file = formData.get('imageFile');

		if (file && file instanceof File) {
			const arrayBuffer = await file.arrayBuffer();
			const uint8Array = new Uint8Array(arrayBuffer);

			const inputs = {
				image: [...uint8Array],
			};

			const response = await env.AI.run(
				"@cf/facebook/detr-resnet-50",
				inputs
			);

			const objs = response.filter((obj) => {
				return obj.score && obj.score > 0.9
			})

			const data = JSON.stringify({
				objs: objs,
				img: uint8ArrayToBase64(uint8Array)
			})

			const name = `uploads/${crypto.randomUUID()}.json`
			await env.R2.put(name, data)

			const excessObjs = await env.R2.list({
				limit: 100
			})
			if (excessObjs.objects.length > 5) {
				const toDelete = excessObjs.objects.sort((a, b) => new Date(a.uploaded) - new Date(b.uploaded)).slice(0, excessObjs.objects.length-5).map((obj) => obj.key)
				await env.R2.delete(toDelete)
			}

			return new Response(JSON.stringify({
				message: 'File processed successfully!',
				fileSize: uint8Array.length,
			}), {
				headers: {'Content-Type': 'application/json'},
			});
		} else {
			return new Response('No valid file uploaded', {status: 400});
		}
	}

	return new Response('Unsupported content type', {status: 415});
}

async function handleList(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const resp = (await env.R2.list())

	const objs = []
	const promisses = []
	for (const obj of resp.objects.sort((a, b) => new Date(a.uploaded) - new Date(b.uploaded)).reverse()) {
		promisses.push(env.R2.get(obj.key))
	}

	for (const p of await Promise.all(promisses)) {
		objs.push(await p?.json())
	}

	return Response.json({
		images: objs
	})
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url)

		if (url.pathname === '/upload' && request.method === "POST") {
			return handleUpload(request, env, ctx)
		}
		if (url.pathname === '/list') {
			return handleList(request, env, ctx)
		}

		return new Response('404')
	},
} satisfies ExportedHandler<Env>;
