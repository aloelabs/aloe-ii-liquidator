printenv > .env

sed -i 's/%WALLET_ADDRESS%/'$WALLET_ADDRESS'/g' app.yaml
sed -i 's/%WALLET_PRIVATE_KEY%/'$WALLET_PRIVATE_KEY'/g' app.yaml
sed -i 's/%API_TOKEN%/'$API_TOKEN'/g' app.yaml
sed -i 's/%ALCHEMY_API_KEY%/'$ALCHEMY_API_KEY'/g' app.yaml
sed -i 's/%FACTORY_ADDRESS%/'$FACTORY_ADDRESS'/g' app.yaml
sed -i 's/%CREATE_ACCOUNT_TOPIC_ID%/'$CREATE_ACCOUNT_TOPIC_ID'/g' app.yaml
sed -i 's/%LIQUIDATOR_ADDRESS%/'$LIQUIDATOR_ADDRESS'/g' app.yaml
sed -i 's/%SLACK_WEBHOOK0%/'$SLACK_WEBHOOK0'/g' app.yaml
sed -i 's/%SLACK_WEBHOOK1%/'$SLACK_WEBHOOK1'/g' app.yaml
sed -i 's/%SLACK_WEBHOOK2%/'$SLACK_WEBHOOK2'/g' app.yaml

cat app.yaml