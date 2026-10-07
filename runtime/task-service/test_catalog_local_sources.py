import json
import tempfile
import unittest
from pathlib import Path

from dispatcher import Dispatcher, file_record
from test_workflow_dispatcher import API


class LocalCatalogTests(unittest.TestCase):
    def collect(self, root, sources, catalog=()):
        folder = root / 'projects/p/workspace'
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / 'sources.json'
        path.write_text(json.dumps({'sources': sources}))
        before = path.read_bytes()
        packet = {'task': {'id': 'collect', 'kind': 'library', 'handler': 'library_collect',
                           'input_refs': [str(path)]},
                  'agent': {'id': 'lib', 'role': 'librarian'},
                  'source_inputs': [{'task_id': 'producer', 'agent_id': 'r1', **file_record(path)}]}
        api = API(list(catalog))
        dispatcher = Dispatcher({'lab_root': str(root), 'runner_id': 'fixture', 'projects': [],
                                 'model': 'fixture', 'codex_bin': 'unused'}, api, root / 'state')
        self.addCleanup(dispatcher.pool.shutdown)
        _, handoff = dispatcher.collected_library(packet, 'p', folder / 'out')
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(dispatcher.stats['model_calls'], 0)
        self.assertEqual([name for name, _ in api.calls], ['library_catalog'])
        return handoff

    def source(self, **changes):
        return {'id': 'local', 'kind': 'dataset', 'title': 'Local dataset',
                'summary': 'Metadata only', 'path': '/shared/metadata.md', 'version': 'snapshot-1',
                'reading': 'Read the metadata; raw values were not opened.',
                'availability': 'Metadata is available.', 'checks': 'No data validation.',
                'read_by': ['r1'], **changes}

    def test_local_records_accept_paths_and_preserve_reading_limits(self):
        for kind in ['dataset', 'baseline', 'tool', 'notes']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                source = self.source(kind=kind)
                row = self.collect(Path(directory), [source])['items'][0]
                self.assertEqual(row['path'], source['path'])
                self.assertEqual(row['reading'], source['reading'])
                self.assertEqual(row['read_by'], ['r1'])
                self.assertNotIn('source', row)

    def test_existing_local_records_keep_canonical_url_and_data_location(self):
        for kind, url in [('baseline', 'https://example.org/paper'), ('dataset', None)]:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                source = self.source(kind=kind)
                old = {**source, 'source': url, 'path': '/shared/raw-or-code', 'revision': 7,
                       'project_ids': ['older'], 'read_by': ['r0']}
                row = self.collect(Path(directory), [source], [old])['items'][0]
                self.assertEqual(row['path'], old['path'])
                self.assertEqual(row['source'], url)
                self.assertIn(source['path'], row['notes'])
                self.assertEqual(row['expected_revision'], 7)
                self.assertEqual(row['project_ids'], ['older', 'p'])
                self.assertEqual(row['read_by'], ['r0', 'r1'])

    def test_missing_location_and_paper_url_still_fail(self):
        for source, message in [(self.source(path=None), 'source location'),
                                (self.source(kind='paper'), 'Missing source field: source')]:
            with self.subTest(source=source), tempfile.TemporaryDirectory() as directory:
                with self.assertRaisesRegex(ValueError, message):
                    self.collect(Path(directory), [source])

    def test_local_revision_and_explicit_url_conflicts_still_fail(self):
        for change in [{'version': 'different'}, {'source': 'https://example.org/other'}]:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                old = {**self.source(), 'source': 'https://example.org/original', 'revision': 1}
                with self.assertRaisesRegex(ValueError, 'Conflicting'):
                    self.collect(Path(directory), [self.source(**change)], [old])

    def test_paper_alias_reuses_explicitly_supplied_catalog_id(self):
        with tempfile.TemporaryDirectory() as directory:
            known = self.source(id='catalog-paper', kind='paper', source='https://arxiv.org/html/2311.16214v3', version='v3')
            old = {**known, 'revision': 2, 'read_by': []}
            holding = {**old, 'id': 'local-pdf-holding'}
            alias = {**known, 'id': 'short-name', 'reading': 'Read another section.'}
            handoff = self.collect(Path(directory), [known, alias], [old, holding])
            self.assertEqual([row['id'] for row in handoff['items']], ['catalog-paper'])
            self.assertIn('short-name', handoff['items'][0]['notes'])
            self.assertIn(alias['reading'], handoff['items'][0]['reading'])

    def test_pinned_url_alias_keeps_published_revision_and_reading_qualifiers(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.source(id='short-name', kind='paper', source='https://arxiv.org/html/2512.07737v2', version='v2')
            old = {**source, 'id': 'saved-paper', 'source': 'https://arxiv.org/abs/2512.07737v2',
                   'version': 'current v2', 'revision': 3, 'read_by': []}
            row = self.collect(Path(directory), [source], [old])['items'][0]
            self.assertEqual(row['id'], old['id'])
            self.assertEqual(row['source'], old['source'])
            self.assertEqual(row['version'], 'v2')
            self.assertIn(source['reading'], row['reading'])

    def test_ambiguous_paper_alias_requires_identity_resolution(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.source(id='short-name', kind='paper', source='https://arxiv.org/html/2311.16214v3', version='v3')
            rows = [{**source, 'id': name, 'revision': 1} for name in ['record-a', 'record-b']]
            with self.assertRaisesRegex(ValueError, 'Ambiguous saved source identity'):
                self.collect(Path(directory), [source], rows)

    def test_same_doi_accepts_publication_label_punctuation_and_keeps_attribution(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.source(id='wake-paper', kind='paper',
                                 source='https://doi.org/10.1029/2018JA025743',
                                 version='Journal of Geophysical Research: Space Physics (2018)',
                                 read_by=['r0'])
            old = {**source, 'version': 'Journal of Geophysical Research: Space Physics, 2018',
                   'revision': 1}
            row = self.collect(Path(directory), [source], [old])['items'][0]
            self.assertEqual(row['version'], old['version'])
            self.assertIn('Producer version statement: '+source['version'], row['notes'])
            self.assertEqual(row['read_by'], ['r0'])
            self.assertIn('adds no primary-source reading credit', row['notes'])

    def test_doi_label_repair_rejects_distinct_years_revisions_and_locations(self):
        source = self.source(id='wake-paper', kind='paper',
                             source='https://doi.org/10.1029/2018JA025743',
                             version='Journal, 2018, version 1')
        for change in [{'version': 'Journal (2019), version 1'},
                       {'version': 'Journal (2018), version 2'},
                       {'version': 'Journal (2018), accepted manuscript version 1'},
                       {'source': 'https://doi.org/10.1029/2018JA025744',
                        'version': 'Journal (2018), version 1'},
                       {'source': 'https://example.org/unpinned',
                        'version': 'Journal (2018), version 1'}]:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                old = {**source, 'revision': 1}
                with self.assertRaisesRegex(ValueError, 'Conflicting'):
                    self.collect(Path(directory), [{**source, **change}], [old])

    def test_existing_local_paper_can_gain_a_previously_missing_source_url(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.source(id='pdf-holding', kind='paper',
                                 source='https://doi.org/10.1002/qute.201800012', version='unverified')
            old = {**source, 'source': '', 'path': '/shared/original.pdf',
                   'revision': 1, 'project_ids': [], 'read_by': []}
            row = self.collect(Path(directory), [source], [old])['items'][0]
            self.assertEqual(row['source'], source['source'])
            self.assertEqual(row['path'], old['path'])
            self.assertEqual(row['version'], 'unverified')
            self.assertIn('does not verify the paper version', row['notes'])
            self.assertEqual(row['read_by'], ['r1'])

    def test_missing_source_enrichment_cannot_replace_known_identity_or_version(self):
        source = self.source(id='pdf-holding', kind='paper',
                             source='https://doi.org/10.1002/qute.201800012', version='unverified')
        cases = [{'source': 'https://doi.org/10.1002/qute.201800013'},
                 {'source': '', 'version': 'v1'}, {'source': '', 'path': None},
                 {'source': '', 'kind': 'dataset'}]
        for change in cases:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                old = {**source, 'revision': 1, **change}
                with self.assertRaisesRegex(ValueError, 'Conflicting'):
                    self.collect(Path(directory), [source], [old])

    def test_new_publication_label_does_not_upgrade_an_unverified_local_version(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.source(id='pdf-holding', kind='paper',
                                 source='https://doi.org/10.1088/1367-2630/aa916e', version='journal-2017')
            old = {**source, 'source': '', 'path': '/shared/original.pdf',
                   'version': 'unverified', 'revision': 1, 'read_by': []}
            row = self.collect(Path(directory), [source], [old])['items'][0]
            self.assertEqual(row['source'], source['source'])
            self.assertEqual(row['version'], 'unverified')
            self.assertIn('Producer version statement: journal-2017', row['notes'])


if __name__ == '__main__':
    unittest.main()
