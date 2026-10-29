export function renderCameraFrame(canvas, frame) {
  const context = canvas.getContext("2d");
  if (!context || !frame?.imageData) return;
  canvas.width = frame.width;
  canvas.height = frame.height;
  const image = new ImageData(frame.imageData, frame.width, frame.height);
  context.imageSmoothingEnabled = false;
  context.putImageData(image, 0, 0);
}
