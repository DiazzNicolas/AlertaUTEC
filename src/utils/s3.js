/**
 * Utilidades para interactuar con S3
 */
import { S3Client, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Inicializar cliente S3
const s3Client = new S3Client({});

// Bucket desde variable de entorno
const IMAGES_BUCKET = process.env.IMAGES_BUCKET;

// Configuración
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

/**
 * Sube una imagen a S3 desde base64
 * 
 * @param {string} imageData - Imagen en formato base64 (puede incluir el prefijo data:image/...)
 * @param {string} incidentId - ID del incidente
 * @param {number} imageIndex - Índice de la imagen (para múltiples imágenes)
 * @returns {Promise<{s3Key: string, publicUrl: string}>} Objeto con s3Key y publicUrl
 * @throws {Error} Si la imagen es inválida o muy grande
 */
export async function uploadImage(imageData, incidentId, imageIndex = 0) {
  try {
    let actualImageData = imageData;
    let imageType = 'jpeg';

    // Remover prefijo data:image/...;base64, si existe
    if (imageData.includes(',')) {
      const [header, data] = imageData.split(',', 2);
      actualImageData = data;
      
      // Extraer tipo de imagen del header
      if (header.includes('image/')) {
        const match = header.match(/image\/([^;]+)/);
        if (match) {
          imageType = match[1];
        }
      }
    }

    // Decodificar base64
    const imageBuffer = Buffer.from(actualImageData, 'base64');

    // Validar tamaño
    if (imageBuffer.length > MAX_IMAGE_SIZE) {
      throw new Error(`La imagen excede el tamaño máximo de ${MAX_IMAGE_SIZE / (1024 * 1024)}MB`);
    }

    // Generar nombre único
    const fileExtension = 'jpg';
    const filename = `image${imageIndex + 1}.${fileExtension}`;
    const s3Key = `incidents/${incidentId}/${filename}`;

    // Subir a S3
    const command = new PutObjectCommand({
      Bucket: IMAGES_BUCKET,
      Key: s3Key,
      Body: imageBuffer,
      ContentType: `image/${fileExtension}`,
      CacheControl: 'max-age=31536000' // 1 año
    });

    await s3Client.send(command);

    // Generar URL pública
    const publicUrl = `https://${IMAGES_BUCKET}.s3.amazonaws.com/${s3Key}`;

    return { s3Key, publicUrl };

  } catch (error) {
    if (error.message.includes('Invalid base64')) {
      throw new Error('Formato base64 inválido');
    }
    throw new Error(`Error al procesar imagen: ${error.message}`);
  }
}

/**
 * Sube múltiples imágenes a S3
 * 
 * @param {string[]} imagesData - Lista de imágenes en base64
 * @param {string} incidentId - ID del incidente
 * @returns {Promise<Array<{s3Key: string, publicUrl: string}>>} Lista de objetos con s3Key y publicUrl
 */
export async function uploadMultipleImages(imagesData, incidentId) {
  const results = [];

  for (let index = 0; index < imagesData.length; index++) {
    try {
      const result = await uploadImage(imagesData[index], incidentId, index);
      results.push(result);
    } catch (error) {
      console.error(`Error subiendo imagen ${index}:`, error.message);
      // Continuar con las demás imágenes
      continue;
    }
  }

  return results;
}

/**
 * Genera una URL pre-firmada para acceder a una imagen
 * 
 * @param {string} s3Key - Clave S3 de la imagen
 * @param {number} expiresIn - Tiempo de expiración en segundos (default: 1 hora)
 * @returns {Promise<string>} URL pre-firmada
 */
export async function getImageUrl(s3Key, expiresIn = 3600) {
  try {
    const command = new HeadObjectCommand({
      Bucket: IMAGES_BUCKET,
      Key: s3Key
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return signedUrl;
  } catch (error) {
    console.error('Error generando URL:', error.message);
    return `https://${IMAGES_BUCKET}.s3.amazonaws.com/${s3Key}`;
  }
}

/**
 * Elimina una imagen de S3
 * 
 * @param {string} s3Key - Clave S3 de la imagen
 * @returns {Promise<boolean>} True si fue exitoso
 */
export async function deleteImage(s3Key) {
  try {
    const command = new DeleteObjectCommand({
      Bucket: IMAGES_BUCKET,
      Key: s3Key
    });

    await s3Client.send(command);
    return true;
  } catch (error) {
    console.error('Error eliminando imagen:', error.message);
    return false;
  }
}

/**
 * Elimina todas las imágenes de un incidente
 * 
 * @param {string} incidentId - ID del incidente
 * @returns {Promise<boolean>} True si fue exitoso
 */
export async function deleteIncidentImages(incidentId) {
  try {
    // Listar todos los objetos con el prefijo
    const prefix = `incidents/${incidentId}/`;

    const listCommand = new ListObjectsV2Command({
      Bucket: IMAGES_BUCKET,
      Prefix: prefix
    });

    const response = await s3Client.send(listCommand);

    if (!response.Contents || response.Contents.length === 0) {
      return true; // No hay imágenes
    }

    // Eliminar todos los objetos
    const objectsToDelete = response.Contents.map(obj => ({ Key: obj.Key }));

    const deleteCommand = new DeleteObjectsCommand({
      Bucket: IMAGES_BUCKET,
      Delete: {
        Objects: objectsToDelete
      }
    });

    await s3Client.send(deleteCommand);
    return true;
  } catch (error) {
    console.error('Error eliminando imágenes del incidente:', error.message);
    return false;
  }
}

/**
 * Obtiene metadata de una imagen en S3
 * 
 * @param {string} s3Key - Clave S3 de la imagen
 * @returns {Promise<Object|null>} Objeto con metadata o null
 */
export async function getImageMetadata(s3Key) {
  try {
    const command = new HeadObjectCommand({
      Bucket: IMAGES_BUCKET,
      Key: s3Key
    });

    const response = await s3Client.send(command);

    return {
      size: response.ContentLength,
      type: response.ContentType,
      lastModified: response.LastModified,
      etag: response.ETag
    };
  } catch (error) {
    console.error('Error obteniendo metadata:', error.message);
    return null;
  }
}

/**
 * Valida que el formato de la imagen sea correcto
 * 
 * @param {string} imageData - Imagen en base64
 * @returns {boolean} True si es válida
 */
export function validateImageFormat(imageData) {
  try {
    // Remover prefijo si existe
    if (imageData.includes(',')) {
      const [header] = imageData.split(',', 1);
      if (!header.includes('image/')) {
        return false;
      }
    }

    // Intentar decodificar base64
    const buffer = Buffer.from(imageData.split(',')[1] || imageData, 'base64');
    
    // Verificar que el buffer tenga contenido
    return buffer.length > 0;
  } catch (error) {
    return false;
  }
}