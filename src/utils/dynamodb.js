/**
 * Utilidades para interactuar con DynamoDB
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand, 
  UpdateCommand, 
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  BatchGetCommand,
  BatchWriteCommand
} from '@aws-sdk/lib-dynamodb';

// Inicializar cliente DynamoDB
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// Nombres de tablas desde variables de entorno
const USERS_TABLE = process.env.USERS_TABLE;
const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE;
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE;

/**
 * Inserta un item en DynamoDB
 * 
 * @param {string} tableName - Nombre de la tabla
 * @param {Object} item - Item a insertar
 * @returns {Promise<Object>} Respuesta de DynamoDB
 */
export async function putItem(tableName, item) {
  const command = new PutCommand({
    TableName: tableName,
    Item: item
  });
  return docClient.send(command);
}

/**
 * Obtiene un item de DynamoDB por su clave primaria
 * 
 * @param {string} tableName - Nombre de la tabla
 * @param {Object} key - Clave primaria del item
 * @returns {Promise<Object|null>} Item encontrado o null
 */
export async function getItem(tableName, key) {
  const command = new GetCommand({
    TableName: tableName,
    Key: key
  });
  const response = await docClient.send(command);
  return response.Item || null;
}

/**
 * Actualiza un item en DynamoDB
 * 
 * @param {string} tableName - Nombre de la tabla
 * @param {Object} key - Clave primaria del item
 * @param {string} updateExpression - Expresión de actualización
 * @param {Object} expressionValues - Valores para la expresión
 * @param {Object} [expressionNames=null] - Nombres de atributos (opcional)
 * @param {string} [returnValues='ALL_NEW'] - Qué valores retornar
 * @returns {Promise<Object>} Item actualizado
 */
export async function updateItem(
  tableName,
  key,
  updateExpression,
  expressionValues,
  expressionNames = null,
  returnValues = 'ALL_NEW'
) {
  const params = {
    TableName: tableName,
    Key: key,
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionValues,
    ReturnValues: returnValues
  };

  if (expressionNames) {
    params.ExpressionAttributeNames = expressionNames;
  }

  const command = new UpdateCommand(params);
  const response = await docClient.send(command);
  return response.Attributes;
}

/**
 * Elimina un item de DynamoDB
 * 
 * @param {string} tableName - Nombre de la tabla
 * @param {Object} key - Clave primaria del item
 * @returns {Promise<Object>} Respuesta de DynamoDB
 */
export async function deleteItem(tableName, key) {
  const command = new DeleteCommand({
    TableName: tableName,
    Key: key
  });
  return docClient.send(command);
}

/**
 * Consulta items en DynamoDB con condiciones
 * 
 * @param {string} tableName - Nombre de la tabla
 * @param {string} keyConditionExpression - Expresión de condición de clave
 * @param {Object} expressionValues - Valores para la expresión
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Object>} Objeto con items, lastEvaluatedKey y count
 */
export async function queryItems(tableName, keyConditionExpression, expressionValues, options = {}) {
  const params = {
    TableName: tableName,
    KeyConditionExpression: keyConditionExpression,
    ExpressionAttributeValues: expressionValues,
    ScanIndexForward: options.scanForward !== false
  };

  if (options.indexName) {
    params.IndexName = options.indexName;
  }

  if (options.filterExpression) {
    params.FilterExpression = options.filterExpression;
  }

  if (options.limit) {
    params.Limit = options.limit;
  }

  if (options.lastEvaluatedKey) {
    params.ExclusiveStartKey = options.lastEvaluatedKey;
  }

  if (options.expressionNames) {
    params.ExpressionAttributeNames = options.expressionNames;
  }

  const command = new QueryCommand(params);
  const response = await docClient.send(command);

  return {
    items: response.Items || [],
    lastEvaluatedKey: response.LastEvaluatedKey,
    count: response.Count || 0
  };
}

/**
 * Escanea toda una tabla (usar con precaución)
 * 
 * @param {string} tableName - Nombre de la tabla
 * @param {Object} options - Opciones de scan
 * @returns {Promise<Object>} Objeto con items, lastEvaluatedKey y count
 */
export async function scanItems(tableName, options = {}) {
  const params = {
    TableName: tableName
  };

  if (options.filterExpression) {
    params.FilterExpression = options.filterExpression;
  }

  if (options.expressionValues) {
    params.ExpressionAttributeValues = options.expressionValues;
  }

  if (options.limit) {
    params.Limit = options.limit;
  }

  if (options.lastEvaluatedKey) {
    params.ExclusiveStartKey = options.lastEvaluatedKey;
  }

  const command = new ScanCommand(params);
  const response = await docClient.send(command);

  return {
    items: response.Items || [],
    lastEvaluatedKey: response.LastEvaluatedKey,
    count: response.Count || 0
  };
}

/**
 * Obtiene múltiples items en una sola operación
 * 
 * @param {string} tableName - Nombre de la tabla
 * @param {Array<Object>} keys - Lista de claves primarias
 * @returns {Promise<Array>} Lista de items encontrados
 */
export async function batchGetItems(tableName, keys) {
  if (!keys || keys.length === 0) {
    return [];
  }

  const command = new BatchGetCommand({
    RequestItems: {
      [tableName]: {
        Keys: keys
      }
    }
  });

  const response = await docClient.send(command);
  return response.Responses?.[tableName] || [];
}

/**
 * Escribe múltiples items en una sola operación
 * 
 * @param {string} tableName - Nombre de la tabla
 * @param {Array<Object>} items - Lista de items a insertar
 * @returns {Promise<boolean>} True si fue exitoso
 */
export async function batchWriteItems(tableName, items) {
  if (!items || items.length === 0) {
    return true;
  }

  // DynamoDB permite máximo 25 items por batch
  const batches = [];
  for (let i = 0; i < items.length; i += 25) {
    batches.push(items.slice(i, i + 25));
  }

  for (const batch of batches) {
    const command = new BatchWriteCommand({
      RequestItems: {
        [tableName]: batch.map(item => ({
          PutRequest: { Item: item }
        }))
      }
    });
    await docClient.send(command);
  }

  return true;
}

// Funciones específicas para el sistema de incidentes

/**
 * Obtiene un usuario por su ID
 * @param {string} userId - ID del usuario
 * @returns {Promise<Object|null>}
 */
export async function getUserById(userId) {
  return getItem(USERS_TABLE, { userId });
}

/**
 * Obtiene un usuario por su email
 * @param {string} email - Email del usuario
 * @returns {Promise<Object|null>}
 */
export async function getUserByEmail(email) {
  const result = await queryItems(
    USERS_TABLE,
    'email = :email',
    { ':email': email },
    { indexName: 'EmailIndex', limit: 1 }
  );
  const items = result.items || [];
  return items.length > 0 ? items[0] : null;
}

/**
 * Obtiene un incidente por su ID
 * @param {string} incidentId - ID del incidente
 * @returns {Promise<Object|null>}
 */
export async function getIncidentById(incidentId) {
  return getItem(INCIDENTS_TABLE, { incidentId });
}

/**
 * Obtiene incidentes por estado
 * @param {string} status - Estado del incidente
 * @param {number} limit - Límite de resultados
 * @param {Object} lastKey - Última clave evaluada para paginación
 * @returns {Promise<Object>}
 */
export async function getIncidentsByStatus(status, limit = 50, lastKey = null) {
  return queryItems(
    INCIDENTS_TABLE,
    '#status = :status',
    { ':status': status },
    { 
      indexName: 'StatusCreatedAtIndex',
      limit,
      scanForward: false,
      lastEvaluatedKey: lastKey,
      expressionNames: { '#status': 'status' }
    }
  );
}

/**
 * Obtiene incidentes asignados a un trabajador
 * @param {string} workerId - ID del trabajador
 * @param {number} limit - Límite de resultados
 * @returns {Promise<Object>}
 */
export async function getIncidentsByWorker(workerId, limit = 50) {
  return queryItems(
    INCIDENTS_TABLE,
    'assignedTo = :workerId',
    { ':workerId': workerId },
    { 
      indexName: 'AssignedToIndex',
      limit,
      scanForward: false
    }
  );
}

/**
 * Obtiene todos los trabajadores (workers)
 * @returns {Promise<Array>}
 */
export async function getWorkers() {
  const result = await queryItems(
    USERS_TABLE,
    '#role = :role',
    { ':role': 'worker' },
    { 
      indexName: 'RoleIndex',
      expressionNames: { '#role': 'role' }
    }
  );
  return result.items || [];
}