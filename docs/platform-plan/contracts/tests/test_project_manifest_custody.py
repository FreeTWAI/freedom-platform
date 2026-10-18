"""Central custody declarations preserve both sealed formats and legacy clients."""
import copy
import importlib.util
import json
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[4]
SCHEMA = json.loads((ROOT / 'docs/platform-plan/contracts/project-manifest.schema.json').read_text())
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
DATABASE_MODES = ['postgres_envelope_vault', 'postgres_keyring_sealed']


def central_manifest():
    return json.loads((ROOT / 'freedom.project.yaml').read_text())


def validate(manifest):
    errors = list(VALIDATOR.iter_errors(manifest))
    assert not errors, '\n'.join(error.message for error in errors)


@pytest.mark.parametrize('mode', DATABASE_MODES)
@pytest.mark.parametrize('backend', ['cloudflare_worker_secret', 'cloudflare_secrets_store', 'external_kms_hsm'])
def test_each_database_format_accepts_separate_approved_host_keys(mode, backend):
    manifest = central_manifest()
    manifest['data_boundary'].update(dynamic_credential_storage=[mode], credential_root_key_storage=backend)
    validate(manifest)


@pytest.mark.parametrize('mode', DATABASE_MODES)
@pytest.mark.parametrize('changes', [
    {'credential_reference_metadata_in_postgres': False},
    {'credential_root_key_storage': 'none'},
    {'credential_root_key_storage': 'client_owned'},
    {'stores_plaintext_credentials': True},
])
def test_database_formats_reject_missing_metadata_keys_or_plaintext(mode, changes):
    manifest = central_manifest()
    manifest['data_boundary'].update(dynamic_credential_storage=[mode], **changes)
    assert list(VALIDATOR.iter_errors(manifest))


def test_none_cannot_hide_an_active_database_custody_mode():
    manifest = central_manifest()
    manifest['data_boundary']['dynamic_credential_storage'] = ['none', 'postgres_keyring_sealed']
    assert list(VALIDATOR.iter_errors(manifest))


@pytest.mark.parametrize('customer_mode', ['none', 'platform_owned_with_explicit_basis', 'external_client_owned'])
def test_legacy_customer_modes_and_envelope_manifests_remain_valid(customer_mode):
    manifest = central_manifest()
    boundary = manifest['data_boundary']
    boundary.update(customer_data_mode=customer_mode, dynamic_credential_storage=['postgres_envelope_vault'])
    if customer_mode == 'external_client_owned':
        boundary['external_systems_of_record'] = ['github', 'client_storage']
    validate(manifest)


def test_central_and_example_declare_hosted_records_without_client_storage():
    example = yaml.safe_load((ROOT / 'docs/platform-plan/contracts/project-manifest.example.yaml').read_text())
    for manifest in [central_manifest(), example]:
        validate(manifest)
        boundary = manifest['data_boundary']
        assert boundary['customer_data_mode'] == 'platform_hosted_for_members'
        assert boundary['dynamic_credential_storage'] == DATABASE_MODES
        assert boundary['credential_reference_metadata_in_postgres'] is True
        assert boundary['credential_root_key_storage'] == 'cloudflare_worker_secret'
        assert boundary['stores_plaintext_credentials'] is False
        assert not {'client_database', 'client_storage'} & set(boundary['external_systems_of_record'])


def test_external_client_mode_still_requires_its_own_storage_boundary():
    manifest = central_manifest()
    manifest['data_boundary']['customer_data_mode'] = 'external_client_owned'
    assert list(VALIDATOR.iter_errors(manifest))


def test_bootstrap_core_matches_canonical_custody_without_changing_consumer_defaults():
    # Import the pure constructor only: never run the nine-checkout/GitHub main.
    spec = importlib.util.spec_from_file_location('manifest_generator', ROOT / 'scripts/repository-bootstrap/generate-manifests.py')
    generator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generator)
    owner = {'id': 900001, 'type': 'Organization', 'login': 'FreeTWAI', 'html_url': 'https://github.com/FreeTWAI'}
    maintainer = {'id': 900002, 'type': 'User', 'login': 'teddashh', 'html_url': 'https://github.com/teddashh'}
    for name in ['freedom-platform', 'freedom-storefront']:
        observed = {'id': 900003, 'owner': copy.deepcopy(owner), 'full_name': 'FreeTWAI/' + name,
                    'html_url': 'https://github.com/FreeTWAI/' + name, 'fork': False,
                    'default_branch': 'main', 'visibility': 'public'}
        generated = generator.manifest(name, observed, maintainer, SCHEMA)
        validate(generated)
        if name == 'freedom-platform':
            assert generated['data_boundary'] == central_manifest()['data_boundary']
        else:
            assert generated['data_boundary'] == {
                'classification': 'public', 'platform_record_types': [], 'customer_data_mode': 'none',
                'credential_reference_metadata_in_postgres': False, 'dynamic_credential_storage': ['none'],
                'credential_root_key_storage': 'none', 'stores_payment_instrument_data': False,
                'stores_plaintext_credentials': False, 'external_systems_of_record': ['github'],
            }
