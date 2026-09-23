#!/usr/bin/env bash
# Run this from your Mac (needs the Azure CLI logged in - `az login`). It only creates
# and configures Azure resources; it does NOT touch the app VM's running code or
# /etc/api.env. Run it, then follow the rest of slice 6's deploy steps to actually
# switch the app over to using what this creates.
#
# Safe to re-run: every command here is idempotent (re-creating an existing resource
# either no-ops or updates it in place) except `az keyvault secret set`, which is
# supposed to be re-run whenever a secret value changes.
set -euo pipefail

# ---- Fill these in for your environment ----
RG=rg-learn-se
LOCATION=swedencentral
VM_APP=vm-app
# Don't know these two? Run:
#   az network vnet list -g "$RG" -o table
#   az network vnet subnet list -g "$RG" --vnet-name <vnet-name-from-above> -o table
VNET=vnet-learn
APP_SUBNET=snet-private
# Must be globally unique across ALL of Azure, 3-24 characters, letters/digits/hyphens.
KV_NAME="kv-roboadvisor-$RANDOM"

echo "== Creating Key Vault: $KV_NAME =="
az keyvault create \
  --name "$KV_NAME" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --sku standard \
  --enable-rbac-authorization true

echo ""
echo "== Key Vault created. Next: read the CURRENT secrets off the app VM =="
echo "Run this yourself and copy the MONGO_URL and JWT_SECRET values:"
echo "    ssh app 'sudo cat /etc/api.env'"
echo ""
echo "Then set them in the vault (note the double quotes - MONGO_URL contains '&',"
echo "the exact character that caused the bash-sourcing bug back in slice 3):"
echo "    az keyvault secret set --vault-name $KV_NAME --name MongoUrl  --value \"<paste MONGO_URL>\""
echo "    az keyvault secret set --vault-name $KV_NAME --name JwtSecret --value \"<paste JWT_SECRET>\""
echo ""
read -p "Press Enter once you've set both secrets above, to continue provisioning access..." _

echo "== Giving $VM_APP a system-assigned managed identity =="
az vm identity assign --resource-group "$RG" --name "$VM_APP"
PRINCIPAL_ID=$(az vm show -g "$RG" -n "$VM_APP" --query identity.principalId -o tsv)
echo "Managed identity principal ID: $PRINCIPAL_ID"

echo "== Granting that identity read-only access to secrets in $KV_NAME =="
KV_ID=$(az keyvault show --name "$KV_NAME" -g "$RG" --query id -o tsv)
az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role "Key Vault Secrets User" \
  --scope "$KV_ID"
echo "(Role assignments can take a minute or two to actually take effect - that's normal.)"

echo "== Creating a Private Endpoint so the app VM reaches the vault without internet access =="
az network private-endpoint create \
  --name pe-keyvault \
  --resource-group "$RG" \
  --vnet-name "$VNET" \
  --subnet "$APP_SUBNET" \
  --private-connection-resource-id "$KV_ID" \
  --group-id vault \
  --connection-name kv-connection

echo "== Creating the private DNS zone so *.vault.azure.net resolves to that private endpoint =="
az network private-dns zone create \
  --resource-group "$RG" \
  --name "privatelink.vaultcore.azure.net"

az network private-dns link vnet create \
  --resource-group "$RG" \
  --zone-name "privatelink.vaultcore.azure.net" \
  --name kv-dns-link \
  --virtual-network "$VNET" \
  --registration-enabled false

az network private-endpoint dns-zone-group create \
  --resource-group "$RG" \
  --endpoint-name pe-keyvault \
  --name kv-zone-group \
  --private-dns-zone "privatelink.vaultcore.azure.net" \
  --zone-name vault

echo ""
echo "== Done provisioning. =="
echo "Your Key Vault URI (you'll need this for /etc/api.env): https://$KV_NAME.vault.azure.net/"
echo ""
echo "Sanity check before touching any code - run this and confirm it resolves to a"
echo "PRIVATE address (10.x.x.x), not a public one:"
echo "    ssh app 'nslookup $KV_NAME.vault.azure.net'"
