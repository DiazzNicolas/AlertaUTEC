"""
Utilidades para interactuar con DynamoDB
"""
import os
import boto3
from typing import Any, Dict, List, Optional
from decimal import Decimal
from boto3.dynamodb.conditions import Key, Attr


# Inicializar cliente DynamoDB
dynamodb = boto3.resource('dynamodb')

# Nombres de tablas desde variables de entorno
USERS_TABLE = os.environ.get('USERS_TABLE')
INCIDENTS_TABLE = os.environ.get('INCIDENTS_TABLE')
CONNECTIONS_TABLE = os.environ.get('CONNECTIONS_TABLE')


def get_table(table_name: str):
    """
    Obtiene una referencia a una tabla de DynamoDB
    
    Args:
        table_name: Nombre de la tabla
    
    Returns:
        Objeto Table de boto3
    """
    return dynamodb.Table(table_name)


def put_item(table_name: str, item: Dict[str, Any]) -> Dict[str, Any]:
    """
    Inserta un item en DynamoDB
    
    Args:
        table_name: Nombre de la tabla
        item: Item a insertar
    
    Returns:
        Respuesta de DynamoDB
    """
    table = get_table(table_name)
    return table.put_item(Item=item)


def get_item(table_name: str, key: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Obtiene un item de DynamoDB por su clave primaria
    
    Args:
        table_name: Nombre de la tabla
        key: Clave primaria del item
    
    Returns:
        Item encontrado o None
    """
    table = get_table(table_name)
    response = table.get_item(Key=key)
    return response.get('Item')


def update_item(
    table_name: str,
    key: Dict[str, Any],
    update_expression: str,
    expression_values: Dict[str, Any],
    expression_names: Optional[Dict[str, str]] = None,
    return_values: str = "ALL_NEW"
) -> Dict[str, Any]:
    """
    Actualiza un item en DynamoDB
    
    Args:
        table_name: Nombre de la tabla
        key: Clave primaria del item
        update_expression: Expresión de actualización
        expression_values: Valores para la expresión
        expression_names: Nombres de atributos (opcional)
        return_values: Qué valores retornar
    
    Returns:
        Item actualizado
    """
    table = get_table(table_name)
    
    params = {
        'Key': key,
        'UpdateExpression': update_expression,
        'ExpressionAttributeValues': expression_values,
        'ReturnValues': return_values
    }
    
    if expression_names:
        params['ExpressionAttributeNames'] = expression_names
    
    response = table.update_item(**params)
    return response.get('Attributes')


def delete_item(table_name: str, key: Dict[str, Any]) -> Dict[str, Any]:
    """
    Elimina un item de DynamoDB
    
    Args:
        table_name: Nombre de la tabla
        key: Clave primaria del item
    
    Returns:
        Respuesta de DynamoDB
    """
    table = get_table(table_name)
    return table.delete_item(Key=key)


def query_items(
    table_name: str,
    key_condition: Any,
    index_name: Optional[str] = None,
    filter_expression: Optional[Any] = None,
    limit: Optional[int] = None,
    scan_forward: bool = True,
    last_evaluated_key: Optional[Dict] = None
) -> Dict[str, Any]:
    """
    Consulta items en DynamoDB con condiciones
    
    Args:
        table_name: Nombre de la tabla
        key_condition: Condición de clave (usando Key de boto3)
        index_name: Nombre del GSI (opcional)
        filter_expression: Expresión de filtro adicional
        limit: Límite de items
        scan_forward: True para orden ascendente, False para descendente
        last_evaluated_key: Para paginación
    
    Returns:
        Dict con Items y LastEvaluatedKey
    """
    table = get_table(table_name)
    
    params = {
        'KeyConditionExpression': key_condition,
        'ScanIndexForward': scan_forward
    }
    
    if index_name:
        params['IndexName'] = index_name
    
    if filter_expression is not None:
        params['FilterExpression'] = filter_expression
    
    if limit:
        params['Limit'] = limit
    
    if last_evaluated_key:
        params['ExclusiveStartKey'] = last_evaluated_key
    
    response = table.query(**params)
    
    return {
        'items': response.get('Items', []),
        'lastEvaluatedKey': response.get('LastEvaluatedKey'),
        'count': response.get('Count', 0)
    }


def scan_items(
    table_name: str,
    filter_expression: Optional[Any] = None,
    limit: Optional[int] = None,
    last_evaluated_key: Optional[Dict] = None
) -> Dict[str, Any]:
    """
    Escanea toda una tabla (usar con precaución)
    
    Args:
        table_name: Nombre de la tabla
        filter_expression: Expresión de filtro
        limit: Límite de items
        last_evaluated_key: Para paginación
    
    Returns:
        Dict con Items y LastEvaluatedKey
    """
    table = get_table(table_name)
    
    params = {}
    
    if filter_expression is not None:
        params['FilterExpression'] = filter_expression
    
    if limit:
        params['Limit'] = limit
    
    if last_evaluated_key:
        params['ExclusiveStartKey'] = last_evaluated_key
    
    response = table.scan(**params)
    
    return {
        'items': response.get('Items', []),
        'lastEvaluatedKey': response.get('LastEvaluatedKey'),
        'count': response.get('Count', 0)
    }


def batch_get_items(table_name: str, keys: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Obtiene múltiples items en una sola operación
    
    Args:
        table_name: Nombre de la tabla
        keys: Lista de claves primarias
    
    Returns:
        Lista de items encontrados
    """
    if not keys:
        return []
    
    response = dynamodb.batch_get_item(
        RequestItems={
            table_name: {
                'Keys': keys
            }
        }
    )
    
    return response.get('Responses', {}).get(table_name, [])


def batch_write_items(table_name: str, items: List[Dict[str, Any]]) -> bool:
    """
    Escribe múltiples items en una sola operación
    
    Args:
        table_name: Nombre de la tabla
        items: Lista de items a insertar
    
    Returns:
        True si fue exitoso
    """
    if not items:
        return True
    
    table = get_table(table_name)
    
    with table.batch_writer() as batch:
        for item in items:
            batch.put_item(Item=item)
    
    return True


def decimal_to_float(obj: Any) -> Any:
    """
    Convierte objetos Decimal a float recursivamente
    Útil para serializar respuestas de DynamoDB a JSON
    
    Args:
        obj: Objeto que puede contener Decimals
    
    Returns:
        Objeto con Decimals convertidos a float
    """
    if isinstance(obj, list):
        return [decimal_to_float(i) for i in obj]
    elif isinstance(obj, dict):
        return {k: decimal_to_float(v) for k, v in obj.items()}
    elif isinstance(obj, Decimal):
        if obj % 1 == 0:
            return int(obj)
        return float(obj)
    return obj


# Funciones específicas para el sistema de incidentes

def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    """Obtiene un usuario por su ID"""
    return get_item(USERS_TABLE, {'userId': user_id})


def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Obtiene un usuario por su email"""
    result = query_items(
        USERS_TABLE,
        Key('email').eq(email),
        index_name='EmailIndex',
        limit=1
    )
    items = result.get('items', [])
    return items[0] if items else None


def get_incident_by_id(incident_id: str) -> Optional[Dict[str, Any]]:
    """Obtiene un incidente por su ID"""
    return get_item(INCIDENTS_TABLE, {'incidentId': incident_id})


def get_incidents_by_status(status: str, limit: int = 50, last_key: Optional[Dict] = None) -> Dict[str, Any]:
    """Obtiene incidentes por estado"""
    return query_items(
        INCIDENTS_TABLE,
        Key('status').eq(status),
        index_name='StatusCreatedAtIndex',
        limit=limit,
        scan_forward=False,
        last_evaluated_key=last_key
    )


def get_incidents_by_worker(worker_id: str, limit: int = 50) -> Dict[str, Any]:
    """Obtiene incidentes asignados a un trabajador"""
    return query_items(
        INCIDENTS_TABLE,
        Key('assignedTo').eq(worker_id),
        index_name='AssignedToIndex',
        limit=limit,
        scan_forward=False
    )


def get_workers() -> List[Dict[str, Any]]:
    """Obtiene todos los trabajadores (workers)"""
    result = query_items(
        USERS_TABLE,
        Key('role').eq('worker'),
        index_name='RoleIndex'
    )
    return result.get('items', [])