// src/notifications/sendIncidentEmail.js
import { SNSClient, PublishCommand, SubscribeCommand } from '@aws-sdk/client-sns';
import { DynamoDBClient, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const sns = new SNSClient();
const dynamodb = new DynamoDBClient();

const USERS_TABLE = process.env.USERS_TABLE;
const SNS_TOPIC_ARN = process.env.INCIDENT_NOTIFICATION_TOPIC_ARN;

// ===== HANDLER QUE SUSCRIBE ADMINS AL TOPIC (ejecutar una vez) =====
export const subscribeAdminsHandler = async (event) => {
  console.log('=== SUSCRIBIENDO ADMINISTRADORES AL TOPIC SNS ===');
  
  try {
    // Obtener todos los administradores
    const admins = await getAllAdmins();
    console.log(`Administradores encontrados: ${admins.length}`);

    if (admins.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'No hay administradores para suscribir',
          subscribed: 0
        })
      };
    }

    const results = [];
    
    // Suscribir cada admin al topic
    for (const admin of admins) {
      try {
        const subscribeParams = {
          Protocol: 'email',
          TopicArn: SNS_TOPIC_ARN,
          Endpoint: admin.email,
          Attributes: {
            FilterPolicy: JSON.stringify({
              // Opcional: filtrar por prioridad
              // priority: ['high', 'critical']
            })
          }
        };

        const subscribeCommand = new SubscribeCommand(subscribeParams);
        const { SubscriptionArn } = await sns.send(subscribeCommand);
        
        console.log(`✅ Suscrito: ${admin.email}`);
        results.push({
          email: admin.email,
          status: 'subscribed',
          subscriptionArn: SubscriptionArn
        });
      } catch (error) {
        console.error(`❌ Error suscribiendo ${admin.email}:`, error.message);
        results.push({
          email: admin.email,
          status: 'failed',
          error: error.message
        });
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        message: 'Proceso de suscripción completado',
        total: admins.length,
        results
      })
    };

  } catch (error) {
    console.error('Error en subscribeAdmins:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Error suscribiendo administradores',
        details: error.message 
      })
    };
  }
};

// ===== OBTENER ADMINISTRADORES DE DYNAMODB =====
async function getAllAdmins() {
  try {
    // Intentar con GSI primero
    const params = {
      TableName: USERS_TABLE,
      IndexName: 'RoleIndex', // GSI necesario
      KeyConditionExpression: '#role = :adminRole',
      ExpressionAttributeNames: {
        '#role': 'role'
      },
      ExpressionAttributeValues: {
        ':adminRole': { S: 'admin' }
      }
    };

    const command = new QueryCommand(params);
    const result = await dynamodb.send(command);

    return result.Items?.map(item => unmarshall(item)) || [];
  } catch (error) {
    console.error('Error consultando administradores con GSI:', error);
    
    // FALLBACK: Scan si no tienes GSI
    try {
      console.log('⚠️ Usando Scan como fallback...');
      
      const scanParams = {
        TableName: USERS_TABLE,
        FilterExpression: '#role = :adminRole',
        ExpressionAttributeNames: {
          '#role': 'role'
        },
        ExpressionAttributeValues: {
          ':adminRole': { S: 'admin' }
        }
      };
      
      const scanCommand = new ScanCommand(scanParams);
      const scanResult = await dynamodb.send(scanCommand);
      return scanResult.Items?.map(item => unmarshall(item)) || [];
    } catch (scanError) {
      console.error('❌ Error en scan fallback:', scanError);
      return [];
    }
  }
}
