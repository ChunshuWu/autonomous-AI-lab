import copy
import json
import tempfile
import unittest
from pathlib import Path

from dispatcher import Dispatcher, file_record
from test_workflow_dispatcher import API


class RecoveryInputTests(unittest.TestCase):
    def setup_case(self, root):
        project = root / 'projects/p/workspace'
        project.mkdir(parents=True)
        path = project / 'sources.json'
        source = {'id': 'holding', 'kind': 'paper', 'title': 'A paper',
                  'source': 'https://doi.org/10.1002/qute.201800012', 'version': 'v2',
                  'summary': 'Actual reader summary', 'reading': 'Pages 1-2',
                  'availability': 'Local PDF', 'checks': 'Not reproduced', 'read_by': ['r1']}
        path.write_text(json.dumps({'sources': [source]}))
        old = {**source, 'source': 'https://doi.org/10.1002/qute.201800013',
               'revision': 7, 'project_ids': ['another-project']}
        api = API([old, {**old, 'id': 'unrelated'}])
        dispatcher = Dispatcher({'lab_root': str(root), 'runner_id': 'fixture',
                                 'projects': [], 'model': 'fixture', 'codex_bin': 'unused'},
                                api, root / 'state')
        self.addCleanup(dispatcher.pool.shutdown)
        original = {'task': {'id': 'failed-source', 'kind': 'library',
                            'handler': 'library_collect', 'input_refs': [str(path)]},
                    'agent': {'id': 'lib', 'role': 'librarian'},
                    'source_inputs': [{'task_id': 'producer', 'agent_id': 'r1', **file_record(path)}]}
        with self.assertRaisesRegex(ValueError, 'Conflicting'):
            dispatcher.collected_library(original, 'p', dispatcher.folder('p', 'failed-source'))
        recovery = {'task': {'id': 'review', 'kind': 'question', 'input_refs': []},
                    'workflow_context': {'recovery': {'failed_tasks': [{'id': 'failed-source'}]}}}
        return dispatcher, original, recovery, path, old

    def test_preflight_failure_keeps_inputs_and_supplies_unlinked_catalog_record(self):
        with tempfile.TemporaryDirectory() as directory:
            d, original, packet, path, old = self.setup_case(Path(directory))
            before = copy.deepcopy(packet)
            saved = json.loads((d.folder('p', 'failed-source') / 'collection-packet.json').read_text())
            self.assertEqual(saved, original)
            repaired = d.recovery_evidence(packet, 'p')
            self.assertEqual(packet, before)
            self.assertEqual(repaired['task']['input_refs'], [str(path)])
            self.assertEqual(repaired['source_inputs'], original['source_inputs'])
            self.assertEqual(repaired['workflow_context']['recovery']['source_catalog_records'], [old])
            self.assertEqual(json.loads(d.notes(repaired)[0]['text']), json.loads(path.read_text()))
            self.assertEqual(d.stats['model_calls'], 0)

    def test_changed_input_is_rejected_before_a_recovery_model_call(self):
        with tempfile.TemporaryDirectory() as directory:
            d, _, packet, path, _ = self.setup_case(Path(directory))
            path.write_text(path.read_text() + ' ')
            with self.assertRaisesRegex(ValueError, 'hash changed'):
                d.recovery_evidence(packet, 'p')
            self.assertEqual(d.stats['model_calls'], 0)

    def test_source_symlink_and_missing_provenance_are_rejected(self):
        for failure in ['symlink', 'provenance']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                d, _, packet, path, _ = self.setup_case(root)
                if failure == 'symlink':
                    target = root / 'other.json'
                    target.write_bytes(path.read_bytes())
                    path.unlink()
                    path.symlink_to(target)
                else:
                    saved = d.folder('p', 'failed-source') / 'collection-packet.json'
                    data = json.loads(saved.read_text())
                    data['source_inputs'] = []
                    saved.write_text(json.dumps(data))
                with self.assertRaisesRegex(ValueError, 'workspace|provenance'):
                    d.recovery_evidence(packet, 'p')


if __name__ == '__main__':
    unittest.main()
