"""
Utilidades para interactuar con S3
"""
import os
import base64
import uuid
from typing import List, Tuple, Optional
import boto3
from PIL import Image
from io import BytesIO


# Inicializar cliente S3
s3_client = boto3.client('s3')

# Bucket desde variable de entorno
IMAGES_BUCKET = os.environ.get('IMAGES_BUCKET')

# Configuración
MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5 MB
ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'webp'}
THUMBNAIL_SIZE = (300, 300)


def upload_image(
    image_data: str,
    incident_id: str,
    image_index: int = 0
) -> Tuple[str, str]:
    """
    Sube una imagen a S3 desde base64
    
    Args:
        image_data: Imagen en formato base64 (puede incluir el prefijo data:image/...)
        incident_id: ID del incidente
        image_index: Índice de la imagen (para múltiples imágenes)
    
    Returns:
        Tupla con (s3_key, public_url)
    
    Raises:
        ValueError: Si la imagen es inválida o muy grande
    """
    try:
        # Remover prefijo data:image/...;base64, si existe
        if ',' in image_data:
            header, image_data = image_data.split(',', 1)
            # Extraer tipo de imagen del header
            if 'image/' in header:
                image_type = header.split('image/')[1].split(';')[0]
            else:
                image_type = 'jpeg'
        else:
            image_type = 'jpeg'
        
        # Decodificar base64
        image_bytes = base64.b64decode(image_data)
        
        # Validar tamaño
        if len(image_bytes) > MAX_IMAGE_SIZE:
            raise ValueError(f"La imagen excede el tamaño máximo de {MAX_IMAGE_SIZE / (1024*1024)}MB")
        
        # Validar que es una imagen válida
        try:
            img = Image.open(BytesIO(image_bytes))
            img.verify()
        except Exception as e:
            raise ValueError(f"Imagen inválida o corrupta: {str(e)}")
        
        # Reabrir imagen para procesamiento (verify() cierra el archivo)
        img = Image.open(BytesIO(image_bytes))
        
        # Convertir a RGB si es necesario (para PNG con transparencia)
        if img.mode in ('RGBA', 'LA', 'P'):
            background = Image.new('RGB', img.size, (255, 255, 255))
            if img.mode == 'P':
                img = img.convert('RGBA')
            background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
            img = background
        
        # Comprimir y optimizar
        output = BytesIO()
        img.save(output, format='JPEG', quality=85, optimize=True)
        optimized_bytes = output.getvalue()
        
        # Generar nombre único
        file_extension = 'jpg'
        filename = f"image{image_index + 1}.{file_extension}"
        s3_key = f"incidents/{incident_id}/{filename}"
        
        # Subir a S3
        s3_client.put_object(
            Bucket=IMAGES_BUCKET,
            Key=s3_key,
            Body=optimized_bytes,
            ContentType=f'image/{file_extension}',
            CacheControl='max-age=31536000',  # 1 año
        )
        
        # Generar URL pública (con signed URL para acceso controlado)
        public_url = f"https://{IMAGES_BUCKET}.s3.amazonaws.com/{s3_key}"
        
        return s3_key, public_url
    
    except base64.binascii.Error:
        raise ValueError("Formato base64 inválido")
    except Exception as e:
        raise ValueError(f"Error al procesar imagen: {str(e)}")


def upload_multiple_images(
    images_data: List[str],
    incident_id: str
) -> List[Tuple[str, str]]:
    """
    Sube múltiples imágenes a S3
    
    Args:
        images_data: Lista de imágenes en base64
        incident_id: ID del incidente
    
    Returns:
        Lista de tuplas (s3_key, public_url)
    """
    results = []
    
    for index, image_data in enumerate(images_data):
        try:
            s3_key, public_url = upload_image(image_data, incident_id, index)
            results.append((s3_key, public_url))
        except Exception as e:
            print(f"Error subiendo imagen {index}: {str(e)}")
            # Continuar con las demás imágenes
            continue
    
    return results


def get_image_url(s3_key: str, expires_in: int = 3600) -> str:
    """
    Genera una URL pre-firmada para acceder a una imagen
    
    Args:
        s3_key: Clave S3 de la imagen
        expires_in: Tiempo de expiración en segundos (default: 1 hora)
    
    Returns:
        URL pre-firmada
    """
    try:
        url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': IMAGES_BUCKET,
                'Key': s3_key
            },
            ExpiresIn=expires_in
        )
        return url
    except Exception as e:
        print(f"Error generando URL: {str(e)}")
        return f"https://{IMAGES_BUCKET}.s3.amazonaws.com/{s3_key}"


def delete_image(s3_key: str) -> bool:
    """
    Elimina una imagen de S3
    
    Args:
        s3_key: Clave S3 de la imagen
    
    Returns:
        True si fue exitoso
    """
    try:
        s3_client.delete_object(
            Bucket=IMAGES_BUCKET,
            Key=s3_key
        )
        return True
    except Exception as e:
        print(f"Error eliminando imagen: {str(e)}")
        return False


def delete_incident_images(incident_id: str) -> bool:
    """
    Elimina todas las imágenes de un incidente
    
    Args:
        incident_id: ID del incidente
    
    Returns:
        True si fue exitoso
    """
    try:
        # Listar todos los objetos con el prefijo
        prefix = f"incidents/{incident_id}/"
        
        response = s3_client.list_objects_v2(
            Bucket=IMAGES_BUCKET,
            Prefix=prefix
        )
        
        if 'Contents' not in response:
            return True  # No hay imágenes
        
        # Eliminar todos los objetos
        objects_to_delete = [{'Key': obj['Key']} for obj in response['Contents']]
        
        s3_client.delete_objects(
            Bucket=IMAGES_BUCKET,
            Delete={'Objects': objects_to_delete}
        )
        
        return True
    except Exception as e:
        print(f"Error eliminando imágenes del incidente: {str(e)}")
        return False


def create_thumbnail(image_bytes: bytes, size: Tuple[int, int] = THUMBNAIL_SIZE) -> bytes:
    """
    Crea un thumbnail de una imagen
    
    Args:
        image_bytes: Bytes de la imagen
        size: Tupla (ancho, alto) del thumbnail
    
    Returns:
        Bytes del thumbnail
    """
    img = Image.open(BytesIO(image_bytes))
    img.thumbnail(size, Image.Resampling.LANCZOS)
    
    output = BytesIO()
    img.save(output, format='JPEG', quality=85)
    return output.getvalue()


def get_image_metadata(s3_key: str) -> Optional[dict]:
    """
    Obtiene metadata de una imagen en S3
    
    Args:
        s3_key: Clave S3 de la imagen
    
    Returns:
        Dict con metadata o None
    """
    try:
        response = s3_client.head_object(
            Bucket=IMAGES_BUCKET,
            Key=s3_key
        )
        
        return {
            'size': response.get('ContentLength'),
            'type': response.get('ContentType'),
            'lastModified': response.get('LastModified'),
            'etag': response.get('ETag')
        }
    except Exception as e:
        print(f"Error obteniendo metadata: {str(e)}")
        return None


def validate_image_format(image_data: str) -> bool:
    """
    Valida que el formato de la imagen sea correcto
    
    Args:
        image_data: Imagen en base64
    
    Returns:
        True si es válida
    """
    try:
        # Remover prefijo si existe
        if ',' in image_data:
            header, image_data = image_data.split(',', 1)
            if 'image/' not in header:
                return False
        
        # Intentar decodificar
        image_bytes = base64.b64decode(image_data)
        
        # Validar con PIL
        img = Image.open(BytesIO(image_bytes))
        img.verify()
        
        # Verificar formato permitido
        return img.format.lower() in ALLOWED_EXTENSIONS
    except Exception:
        return False