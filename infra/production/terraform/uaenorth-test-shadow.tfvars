# Test/shadow deployment profile for UAE North.
# No real secrets or credentials are committed here.
# The operator must still provide `api_image` and `worker_image` at plan/apply time.

project_name       = "projectx"
environment        = "test"
location           = "uaenorth"
domain_name        = ""
temporal_address   = "quickstart-projectx-test.rpxgu.tmprl.cloud:7233"
temporal_namespace = "quickstart-projectx-test.rpxgu"
# temporal_api_key_secret_id must be supplied at apply time via the existing Key Vault secret reference.
