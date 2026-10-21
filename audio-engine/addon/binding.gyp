{
    "targets": [
        {
            "target_name": "pas_engine",
            "sources": [
                "addon.cpp",
                "../src/Engine.cpp",
                "../src/PriorityMixer.cpp",
                "../src/WasapiRender.cpp",
                "../src/WasapiLoopback.cpp",
                "../src/Meter.cpp",
                "../src/DtxInjector.cpp",
                "../src/Equalizer.cpp",
                "../src/Limiter.cpp",
                "../src/Compressor.cpp"
            ],
            "include_dirs": [
                "../include",
                "<!(node -p \"require('node-addon-api').include_dir\")"
            ],
            "dependencies": [
                "<!(node -p \"require('node-addon-api').targets\"):node_addon_api"
            ],
            "defines": [
                "UNICODE",
                "_UNICODE",
                "NOMINMAX",
                "WIN32_LEAN_AND_MEAN"
            ],
            "libraries": [
                "ole32.lib",
                "uuid.lib",
                "user32.lib",
                "winmm.lib"
            ],
            "msvs_settings": {
                "VCCLCompilerTool": {
                    "ExceptionHandling": 1,
                    "AdditionalOptions": [
                        "/std:c++17",
                        "/permissive-",
                        "/EHsc"
                    ]
                }
            },
            "conditions": [
                ["OS=='win'", {
                    "defines": ["_WIN32_WINNT=0x0A00"]
                }]
            ]
        }
    ]
}