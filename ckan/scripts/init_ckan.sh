#!/bin/bash
set -e

echo "init_ckan ..."

# synchronize persistent data files
rsync -au ${DATA_DIR}_base/. ${DATA_DIR}

# apply templates
jinja2 ${TEMPLATE_DIR}/production.ini.j2 -o ${APP_DIR}/production.ini
jinja2 ${TEMPLATE_DIR}/who.ini.j2 -o ${APP_DIR}/who.ini

# run prerun script that checks connections and inits db
python prerun.py || { echo '[CKAN prerun] FAILED. Exiting...' ; exit 1; }

echo "Upgrade CKAN database ..."
ckan -c ${APP_DIR}/production.ini db upgrade

if [[ "${DEV_MODE}" == "true" ]]; then
  echo "Initializing test database"
  echo ${DB_CKAN_PASS} | psql -h ${DB_HOST} -U ${DB_CKAN_USER} -c "CREATE DATABASE ckan_test OWNER ${DB_CKAN_USER} ENCODING 'utf-8'"
fi
# init ckan extensions
#echo "init ckan extensions ..."

# init ckan extension databases
#echo "init ckan extension databases ..."

# set init flag to done
echo "$CKAN_IMAGE_TAG" > ${DATA_DIR}/.init-done
