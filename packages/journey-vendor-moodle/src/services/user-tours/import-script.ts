/**
 * Runs inside the Moodle container as `php <script> [--disable-others] <tour.json>...`. It imports each tour
 * with Moodle's own importer, replacing a tour of the same name so a long-lived stack does not collect
 * copies, optionally disables every other tour (such as shipped ones), and prints all tours as JSON.
 */
export const importToursScript = String.raw`<?php
define('CLI_SCRIPT', true);
require('/var/www/html/config.php');

$files = array_slice($argv, 1);
$disableothers = ($files[0] ?? '') === '--disable-others';
if ($disableothers) {
    array_shift($files);
}
$imported = [];
foreach ($files as $file) {
    $json = file_get_contents($file);
    $config = json_decode($json);
    if (!$config || empty($config->name) || !isset($config->steps) || !is_array($config->steps)) {
        fwrite(STDERR, "Not a user tour export: $file\n");
        exit(1);
    }
    foreach (\tool_usertours\helper::get_tours() as $existing) {
        if ($existing->get_name() === $config->name) {
            $existing->remove();
        }
    }
    $imported[] = (int) \tool_usertours\manager::import_tour_from_json($json)->get_id();
}
if ($disableothers) {
    foreach (\tool_usertours\helper::get_tours() as $tour) {
        if (!in_array((int) $tour->get_id(), $imported, true) && $tour->is_enabled()) {
            $tour->set_enabled(false);
            $tour->persist();
        }
    }
}
$tours = [];
foreach (\tool_usertours\helper::get_tours() as $tour) {
    $tours[] = ['id' => (int) $tour->get_id(), 'name' => $tour->get_name(), 'enabled' => (bool) $tour->is_enabled(),
        'imported' => in_array((int) $tour->get_id(), $imported, true)];
}
echo json_encode(['tours' => $tours]);
`;
