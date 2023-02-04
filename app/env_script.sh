printenv > .env

sed -i 's/%WALLET_ADDRESS%/'$WALLET_ADDRESS'/g' app.yaml
sed -i 's/%WALLET_PRIVATE_KEY%/'$WALLET_PRIVATE_KEY'/g' app.yaml
sed -i 's/%API_TOKEN%/'$API_TOKEN'/g' app.yaml
sed -i 's/%OPTIMISM_API_TOKEN%/'$OPTIMISM_API_TOKEN'/g' app.yaml
sed -i 's/%PROTOCOL%/'$PROTOCOL'/g' app.yaml
sed -i 's/%OPTIMISM_MAINNET_ENDPOINT%/'$OPTIMISM_MAINNET_ENDPOINT'/g' app.yaml
sed -i 's/%FACTORY_ADDRESS%/'$FACTORY_ADDRESS'/g' app.yaml
sed -i 's/%CREATE_ACCOUNT_TOPIC_ID%/'$CREATE_ACCOUNT_TOPIC_ID'/g' app.yaml
sed -i 's/%LIQUIDATOR_ADDRESS%/'$LIQUIDATOR_ADDRESS'/g' app.yaml
sed -i 's/%SLACK_WEBHOOK%/'$SLACK_WEBHOOK'/g' app.yaml

cat app.yaml