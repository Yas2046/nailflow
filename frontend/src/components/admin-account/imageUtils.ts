// Mesmo recorte quadrado e compressão usados hoje em Perfil.tsx e Admin.tsx para a foto
// (cópia própria da Central da Conta: aqueles arquivos pertencem a outros fluxos).

/** Limite do backend para avatar_b64 (authController.MAX_AVATAR_B64_BYTES). */
export const MAX_AVATAR_B64_CHARS = 90_000;

export function resizeImageToBase64(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Não foi possível processar a imagem.'));
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida. Use JPEG, PNG ou WebP.')); };
    img.src = url;
  });
}
