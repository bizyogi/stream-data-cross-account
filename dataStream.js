'use strict';

const AWS = require('aws-sdk');
const sts = new AWS.STS();
const roleToAssume = {
  RoleArn: 'arn:aws:iam::333009048743:role/bizdev-dynamodb-full-access',
  RoleSessionName: 'bizYogi',
  DurationSeconds: 900
};

module.exports.nmProductFeedReplicationDev = async (event) => {
  try {
    let convertedData = {};

    for (let index = 0; index < event.Records.length; index++) {
      const element = event.Records[index];
      convertedData = convertStreamDataAndProccess(element);
    }

    console.log('convertedData ==========>', convertedData);

    const resultData = await putImageDataInCrossAccountDynamodbTable({ convertedData });
    console.log(resultData, 'resultData');

    return true;
  } catch (error) {
    console.log('Error from nmProductFeedReplicationDev', error);
  }
};

const convertStreamDataAndProccess = (record) => {
  try {
    // Convert from base64 to Buffer to JSON string
    const imageStrData = Buffer.from(record.kinesis.data, 'base64').toString()
    // ...to an object
    const imageData = JSON.parse(imageStrData);

    console.log('imageData =====>', imageData);

    return imageData;

  } catch (error) {
    console.log('error while converting an record', error);
    return false;
  }
}

const putImageDataInCrossAccountDynamodbTable = async ({ convertedData }) => {
  try {
    const data = await sts.assumeRole(roleToAssume).promise();

    // resolving static credential
    const creds = new AWS.Credentials({
      accessKeyId: data.Credentials.AccessKeyId,
      secretAccessKey: data.Credentials.SecretAccessKey,
      sessionToken: data.Credentials.SessionToken
    });

    // Query function
    const documentClient = new AWS.DynamoDB({ apiVersion: '2012-08-10', credentials: creds, region: 'us-west-2' });
    const TableName = 'nm-dt-product-feed-dev';

    if (convertedData.eventName === 'INSERT') {
      const insertParams = {
        TableName: TableName,
        Item: convertedData.dynamodb.NewImage
      }
      await documentClient.putItem(insertParams).promise();
    } else {
      const params = {
        TableName: TableName,
        Key: convertedData.dynamodb.Keys
      };

      const itemExist = await documentClient.getItem(params).promise();

      if (convertedData.eventName === 'MODIFY') {
        if (itemExist) {
          const updateData = updateExpression(convertedData.dynamodb.NewImage);
          if (updateData.ExpressionAttributeNames && updateData.ExpressionAttributeValues) {
            const updateParams = {
              TableName: TableName,
              Key: convertedData.dynamodb.Keys,
              UpdateExpression: updateData.updateExpression,
              ExpressionAttributeNames: updateData.ExpressionAttributeNames,
              ExpressionAttributeValues: updateData.ExpressionAttributeValues
            }
            await documentClient.updateItem(updateParams).promise();
          }
        } else {
          const updateParams = {
            TableName: TableName,
            Item: convertedData.dynamodb.NewImage
          }
          await documentClient.putItem(updateParams).promise();
        }
      } else if (convertedData.eventName === 'REMOVE') {
        if (itemExist) {
          await documentClient.deleteItem(params).promise();
        }
      }
    }
    return true;
  } catch (error) {
    console.log('Error while proccessing data', error);
  }
}

const updateExpression = (Item) => {
  try {
    let updateExpression = 'set';
    let ExpressionAttributeNames = {};
    let ExpressionAttributeValues = {};
    for (const property in Item) {
      if (property !== 'id') {
        updateExpression += ` #${property} = :${property} ,`;
        ExpressionAttributeNames['#' + property] = property;
        ExpressionAttributeValues[':' + property] = Item[property];
      }
    }

    updateExpression = updateExpression.slice(0, -1);

    return {
      updateExpression: updateExpression,
      ExpressionAttributeNames: ExpressionAttributeNames,
      ExpressionAttributeValues: ExpressionAttributeValues
    }

  } catch (error) {
    console.log("Error while generating an expression", error);
    return false;
  }
}
