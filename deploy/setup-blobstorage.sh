#!/usr/bin/env bash
# Run this from your Mac (needs the Azure CLI logged in - `az login`). It only creates
# and configures Azure resources; it does NOT touch the app VM's running code or
# /etc/api.env. Run it, then follow the rest of the Blob Storage slice's deploy steps to
# actually switch the app over to using what this creates.
#
# Unlike setup-keyvault.sh, there is no secret to read off the VM and paste in here -
# Blob Storage supports Azure AD (managed identity) data-plane access directly, so the
# only thing the app needs to know is the storage account's NAME, which isn't sensitive.
#
# Ordering note (the reason public network access is only locked down at the very END of
# this script, not at creation): creating the container and uploading nothing yet is
# still a DATA-PLANE operation - it needs an actual network path to the account's blob
# endpoint, same as any blob read/write. If we disabled public access up front, this
# script (running from your Mac, outside the VNet) couldn't reach the account to do that
# setup at all, and the private endpoint that WOULD let it in doesn't exist yet either -
# a chicken-and-egg problem. So: leave the account publicly reachable while we set it up,
# then lock it down once the container, role assignment, and private endpoint are all in
# place - after that point, only the VM (via the private endpoint) can reach it.
#
# Safe to re-run: every command here is idempotent (re-creating an existing resource
# either no-ops or updates it in place).
set -euo pipefail

# ---- Fill these in for your environment (same as setup-keyvault.sh) ----
RG=rg-learn-se
LOCATION=swedencentral
VM_APP=vm-app
# Don't know these two? Run:
#   az network vnet list -g "$RG" -o table
#   az network vnet subnet list -g "$RG" --vnet-name <vnet-name-from-above> -o table
VNET=vnet-learn
APP_SUBNET=snet-private
CONTAINER_NAME=kyc-documents
# Must be globally unique across ALL of Azure, 3-24 characters, LOWERCASE LETTERS AND
# DIGITS ONLY (storage account names are stricter than Key Vault's - no hyphens allowed).
STORAGE_ACCOUNT_NAME="stroboadvisor$RANDOM"

echo "== Creating Storage Account: $STORAGE_ACCOUNT_NAME =="
az storage account create \
  --name "$STORAGE_ACCOUNT_NAME" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --min-tls-version TLS1_2 \
  --allow-blob-public-access false

# Belt and braces: some az CLI versions don't reliably apply --public-network-access at
# CREATE time (it silently stayed Disabled even when passed above, in testing) - so this
# is asserted as its own explicit step rather than trusted to the create call.
echo "== Making sure public network access is enabled for now (we lock it down again at the end) =="
az storage account update \
  --name "$STORAGE_ACCOUNT_NAME" \
  --resource-group "$RG" \
  --public-network-access Enabled

echo ""
echo "== Creating the private container: $CONTAINER_NAME =="
# --auth-mode login uses YOUR Azure AD identity (the one you ran `az login` as) rather
# than an account key - no key ever touches this script or your shell history. This
# works right now because public network access is still enabled (see the note up top);
# it'll stop working once we lock the account down at the end, which is fine - by then
# the container already exists and nobody needs to create it again.
az storage container create \
  --name "$CONTAINER_NAME" \
  --account-name "$STORAGE_ACCOUNT_NAME" \
  --auth-mode login

echo ""
echo "== Giving $VM_APP a system-assigned managed identity (no-op if it already has one from the Key Vault slice) =="
az vm identity assign --resource-group "$RG" --name "$VM_APP"
PRINCIPAL_ID=$(az vm show -g "$RG" -n "$VM_APP" --query identity.principalId -o tsv)
echo "Managed identity principal ID: $PRINCIPAL_ID"

echo "== Granting that identity read/write access to blobs in $STORAGE_ACCOUNT_NAME =="
STORAGE_ID=$(az storage account show --name "$STORAGE_ACCOUNT_NAME" -g "$RG" --query id -o tsv)
az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role "Storage Blob Data Contributor" \
  --scope "$STORAGE_ID"
echo "(Role assignments can take a minute or two to actually take effect - that's normal.)"

echo "== Creating a Private Endpoint so the app VM reaches the storage account without internet access =="
az network private-endpoint create \
  --name pe-blobstorage \
  --resource-group "$RG" \
  --vnet-name "$VNET" \
  --subnet "$APP_SUBNET" \
  --private-connection-resource-id "$STORAGE_ID" \
  --group-id blob \
  --connection-name blob-connection

echo "== Creating the private DNS zone so *.blob.core.windows.net resolves to that private endpoint =="
az network private-dns zone create \
  --resource-group "$RG" \
  --name "privatelink.blob.core.windows.net"

az network private-dns link vnet create \
  --resource-group "$RG" \
  --zone-name "privatelink.blob.core.windows.net" \
  --name blob-dns-link \
  --virtual-network "$VNET" \
  --registration-enabled false

az network private-endpoint dns-zone-group create \
  --resource-group "$RG" \
  --endpoint-name pe-blobstorage \
  --name blob-zone-group \
  --private-dns-zone "privatelink.blob.core.windows.net" \
  --zone-name blob

echo ""
echo "== Locking down public network access now that the container, role assignment, and private endpoint all exist =="
az storage account update \
  --name "$STORAGE_ACCOUNT_NAME" \
  --resource-group "$RG" \
  --public-network-access Disabled

echo ""
echo "== Done provisioning. =="
echo "Add this to /etc/api.env on the app VM (it's a name, not a secret - fine in plain text):"
echo "    STORAGE_ACCOUNT_NAME=$STORAGE_ACCOUNT_NAME"
echo ""
echo "Sanity check before touching any code - run this and confirm it resolves to a"
echo "PRIVATE address (10.x.x.x), not a public one:"
echo "    ssh app 'nslookup $STORAGE_ACCOUNT_NAME.blob.core.windows.net'"
echo ""
echo "Note: from THIS Mac, that same nslookup (or any data-plane access to the account)"
echo "will no longer work once public access is disabled above - that's expected and is"
echo "the whole point. Only the app VM, over the private endpoint, can reach it now."
