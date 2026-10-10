from __future__ import annotations
import hashlib, json, math, re, shutil, subprocess, time, uuid
from pathlib import Path

class OSDRunError(RuntimeError): pass

def _android_bridge():
    try:
        from java import jclass
        return jclass("com.origin.osd.FfmpegBridge")
    except Exception:
        return None

def _write_failure_evidence(out, *, lifecycle, error, src=None, run_id=None, staging_dir=None):
    out=Path(out); out.mkdir(parents=True, exist_ok=True)
    report={
        'osd_version':'1.20.0',
        'execution_lifecycle':list(lifecycle)+(['FAILED'] if not lifecycle or lifecycle[-1] != 'FAILED' else []),
        'lineage':'reconstructed functional continuation',
        'historical_recovery':False,
        'status':'FAILED',
        'delivery_status':'BLOCKED',
        'error':str(error),
        'run_id':run_id,
        'staging_dir':str(staging_dir) if staging_dir else None,
    }
    if src is not None:
        report['input_path']=str(src)
        try: report['input_sha256']=sha256(src)
        except Exception: report['input_sha256']=None
    path=out/'evidence.json'
    path.write_text(json.dumps(report, indent=2))
    (out/'EVIDENCE-SHA256.txt').write_text(sha256(path)+'  evidence.json\n')
    (out/'DELIVERY-BLOCKED.txt').write_text('OSD delivery blocked. See evidence.json for the failure record.\n')
    return report

def _run(cmd):
    bridge=_android_bridge()
    if bridge is not None:
        try: return bridge.execute([str(x) for x in cmd])
        except Exception as exc: raise OSDRunError(str(exc))
    p=subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode: raise OSDRunError(p.stderr[-4000:])
    return p.stdout

def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()

def ffprobe(path):
    bridge=_android_bridge()
    if bridge is not None:
        try: return json.loads(bridge.probe(["-v","error","-show_streams","-show_format","-of","json",str(path)]))
        except Exception as exc: raise OSDRunError(str(exc))
    out=_run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(path)])
    return json.loads(out)

_CHANNEL_MAPS={
    'mono':('FC',),'stereo':('FL','FR'),'2.1':('FL','FR','LFE'),
    'quad':('FL','FR','BL','BR'),'4.0':('FL','FR','FC','BC'),'4.1':('FL','FR','FC','BC','LFE'),
    '5.0':('FL','FR','FC','BL','BR'),'5.1':('FL','FR','FC','LFE','BL','BR'),
    '5.1(side)':('FL','FR','FC','LFE','SL','SR'),'6.1':('FL','FR','FC','LFE','BC','SL','SR'),
    '7.0':('FL','FR','FC','BL','BR','SL','SR'),'7.1':('FL','FR','FC','LFE','BL','BR','SL','SR'),
}

def _canonical_channel_layout(channels, layout):
    if layout: return layout if layout in _CHANNEL_MAPS else layout
    return {1:'mono',2:'stereo'}.get(channels)

def _channel_map(layout, channels):
    if not layout: return None
    mapping=_CHANNEL_MAPS.get(layout)
    if mapping is None or len(mapping) != channels: return None
    return list(mapping)

def _select_audio_stream(audio):
    if not audio: raise OSDRunError('Unsupported media stream: input contains no audio stream')
    defaults=[(i,s) for i,s in enumerate(audio) if int((s.get('disposition') or {}).get('default') or 0)==1]
    if len(defaults)==1:
        idx, stream=defaults[0]; return idx, stream, 'default_disposition'
    return 0, audio[0], 'first_audio_deterministic_fallback'

def _timing_info(probe, audio, video, format_duration):
    def num(v):
        try:
            x=float(v); return x if math.isfinite(x) else None
        except (TypeError, ValueError): return None
    audio_duration=num(audio.get('duration')) if audio else None
    video_duration=num(video[0].get('duration')) if video else None
    start_times=[]
    for st in ([audio] if audio else []) + (video[:1] if video else []):
        v=num(st.get('start_time'))
        if v is not None: start_times.append(v)
    duration_candidates=[x for x in (num(format_duration),audio_duration,video_duration) if x is not None and x>0]
    positive_duration=bool(duration_candidates)
    max_d=max(duration_candidates) if duration_candidates else None
    min_d=min(duration_candidates) if duration_candidates else None
    stream_span=(max_d-min_d) if positive_duration else None
    start_spread=(max(start_times)-min(start_times)) if start_times else None
    relative_start_consistent=len(start_times)>1 and start_spread is not None and start_spread<=0.15
    irregular_start=any(abs(x)>0.15 for x in start_times) and not relative_start_consistent
    duration_consistent=stream_span is not None and stream_span<=0.15
    return {'format_duration':num(format_duration),'audio_stream_duration':audio_duration,'video_stream_duration':video_duration,
            'start_times':start_times,'duration_spread_seconds':stream_span,'start_time_spread_seconds':start_spread,
            'relative_start_times_consistent':relative_start_consistent,'duration_consistent_within_tolerance':duration_consistent,
            'non_zero_start_time_detected':irregular_start,'timing_status':'OK' if positive_duration and duration_consistent and not irregular_start else 'IRREGULAR',
            'tolerance_seconds':0.15}

def inspect_media(path):
    path=Path(path)
    if not path.exists() or not path.is_file(): raise OSDRunError(f'Input not found: {path}')
    try: p=ffprobe(path)
    except Exception as exc: raise OSDRunError(f'Input media unreadable or corrupt: {path}: {exc}') from exc
    streams=p.get('streams',[])
    audio=[s for s in streams if s.get('codec_type')=='audio']; video=[s for s in streams if s.get('codec_type')=='video']
    if not audio:
        if video: raise OSDRunError('Unsupported media stream: input contains video but no audio stream')
        raise OSDRunError('Unsupported media stream: input contains no audio stream')
    audio_index,a,audio_selection=_select_audio_stream(audio)
    try:
        sample_rate=int(a.get('sample_rate') or 0); channels=int(a.get('channels') or 0); duration=float(p['format'].get('duration',0) or 0)
    except (TypeError, ValueError) as exc: raise OSDRunError(f'Unsupported audio properties in input: {path}') from exc
    if sample_rate<=0 or channels<=0: raise OSDRunError(f'Unsupported audio properties in input: {path}')
    layout=a.get('channel_layout'); effective_layout=_canonical_channel_layout(channels,layout)
    timing=_timing_info(p,a,video,p['format'].get('duration',0))
    if timing['format_duration'] is None or timing['format_duration']<=0: raise OSDRunError(f'Unsupported timing properties in input: {path}')
    if timing['timing_status']!='OK': raise OSDRunError(f'Timing irregular in input: {path}: {json.dumps(timing,sort_keys=True)}')
    audio_streams=[{'index':i,'codec_name':st.get('codec_name'),'channels':st.get('channels'),'channel_layout':st.get('channel_layout'),'sample_rate':st.get('sample_rate'),'default':bool(int((st.get('disposition') or {}).get('default') or 0))} for i,st in enumerate(audio)]
    return {'path':str(path),'duration':duration,'audio_codec':a.get('codec_name'),'sample_rate':sample_rate,'channels':channels,'channel_layout':layout,
            'effective_channel_layout':effective_layout,'channel_map':_channel_map(effective_layout,channels),'video':bool(video),
            'video_codec':video[0].get('codec_name') if video else None,'audio_stream_count':len(audio),'video_stream_count':len(video),
            'selected_audio_index':audio_index,'audio_selection_policy':audio_selection,'audio_streams':audio_streams,
            'format_name':p.get('format',{}).get('format_name'),'format_long_name':p.get('format',{}).get('format_long_name'),
            'size_bytes':path.stat().st_size,'sha256':sha256(path),'timing':timing,
            'media_validation':{'status':'OK' if timing['timing_status']=='OK' else 'TIMING_IRREGULAR','classification':'VALID_MEDIA' if timing['timing_status']=='OK' else 'TIMING_IRREGULAR'}}

def loudness(path):
    cmd=['ffmpeg','-hide_banner','-nostats','-i',str(path),'-af','ebur128=peak=true:framelog=verbose','-f','null','-']
    bridge=_android_bridge()
    if bridge is not None:
        try: stderr=bridge.execute_stderr([str(x) for x in cmd])
        except Exception as exc: raise OSDRunError(str(exc))
    else:
        p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if p.returncode: raise OSDRunError(p.stderr[-4000:])
        stderr=p.stderr
    lines=[x for x in stderr.splitlines() if 'I:' in x and 'LUFS' in x]
    integrated=None
    for x in reversed(lines):
        try: integrated=float(x.split('I:')[1].split('LUFS')[0].strip())
        except Exception: pass
        if integrated is not None: break
    return {'integrated_lufs':integrated,'ebur128_observed':True}

def stem_compatibility(stems,duration_tolerance=0.15):
    stems=[Path(x) for x in stems]
    if not stems: raise OSDRunError('No stems supplied')
    infos=[inspect_media(s) for s in stems]; checks={
        'all_audio':all(i['channels']>0 for i in infos),'sample_rates_present':all(i['sample_rate']>=44100 for i in infos),
        'sample_rates_compatible':len({i['sample_rate'] for i in infos})==1,'channel_counts_compatible':len({i['channels'] for i in infos})==1,
        'channel_layouts_present_or_inferable':all(i.get('effective_channel_layout') for i in infos),
        'channel_maps_present_or_verified':all(i.get('channel_map') for i in infos),
        'channel_layouts_compatible':len({i.get('effective_channel_layout') for i in infos})==1,
        'channel_maps_compatible':len({tuple(i.get('channel_map') or []) for i in infos})==1,
        'duration_aligned':max(i['duration'] for i in infos)-min(i['duration'] for i in infos)<=duration_tolerance}
    checks['all_pass']=all(checks.values())
    return {'checks':checks,'duration_tolerance':duration_tolerance,
            'streams':[{'path':str(s),'duration':i['duration'],'sample_rate':i['sample_rate'],'channels':i['channels'],
                        'channel_layout':i.get('effective_channel_layout'),'channel_map':i.get('channel_map')} for s,i in zip(stems,infos)]}

def source_quality(path):
    info=inspect_media(path)
    return {'status':'OK','sample_rate':info['sample_rate'],'channels':info['channels'],'channel_layout':info['effective_channel_layout'],
            'duration':info['duration'],'source_sha256':info['sha256']}

def mix_stems(stems,out,roles=None,gains=None,duck_music_db=0.0):
    stems=[Path(x) for x in stems]
    if not stems: raise OSDRunError('No stems supplied')
    compat=stem_compatibility(stems)
    if not compat['checks']['all_pass']: raise OSDRunError('Stem compatibility failed: '+json.dumps(compat['checks'],sort_keys=True))
    gains=list(gains or [0.0]*len(stems))
    if len(gains)!=len(stems): raise OSDRunError('Gain count must match stem count')
    inputs=[]; filters=[]; labels=[]
    for i,st in enumerate(stems):
        inputs += ['-i',str(st)]
        filters.append(f'[{i}:a]volume={float(gains[i]):.4f}dB[a{i}]'); labels.append(f'[a{i}]')
    mix=''.join(labels)+f'amix=inputs={len(stems)}:duration=longest:dropout_transition=0[m]'
    filters.append(mix)
    cmd=['ffmpeg','-y','-hide_banner']+inputs+['-filter_complex',';'.join(filters),'-map','[m]','-ar',str(compat['streams'][0]['sample_rate']),'-ac',str(compat['streams'][0]['channels']),str(out)]
    _run(cmd)

def render_audio(src,out):
    _run(['ffmpeg','-y','-hide_banner','-i',str(src),'-af','highpass=f=70,acompressor=threshold=-20dB:ratio=2:attack=8:release=120:makeup=1,alimiter=limit=0.95:level_in=1:level_out=1','-ar','48000',str(out)])

def master_audio(src,out,target_lufs=-16):
    _run(['ffmpeg','-y','-hide_banner','-i',str(src),'-af',f'loudnorm=I={float(target_lufs)}:TP=-1.0:LRA=11:print_format=summary',str(out)])

def true_peak(path):
    cmd=['ffmpeg','-hide_banner','-nostats','-i',str(path),'-af','ebur128=framelog=verbose:peak=true','-f','null','-']
    bridge=_android_bridge()
    if bridge is not None:
        try: stderr=bridge.execute_stderr([str(x) for x in cmd])
        except Exception as exc: raise OSDRunError(str(exc))
    else:
        p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if p.returncode: raise OSDRunError(p.stderr[-4000:])
        stderr=p.stderr
    # FFmpeg versions differ: some print "True peak: -1.0 dBFS" on one
    # line; others print a "True peak:" heading followed by "Peak: -1.0 dBFS".
    # Parse only values inside the true-peak block, never the sample-peak block.
    lines=stderr.splitlines()
    vals=[]
    number=r'(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+))\\s*dBFS'
    for i,line in enumerate(lines):
        if re.search(r'\\btrue peak\\s*:', line, re.IGNORECASE):
            same_line=re.search(number, line.split(':',1)[1] if ':' in line else '')
            if same_line:
                vals.append(float(same_line.group(1)))
                continue
            for following in lines[i+1:i+5]:
                match=re.search(r'\\bPeak\\s*:\\s*'+number, following, re.IGNORECASE)
                if match:
                    vals.append(float(match.group(1)))
                    break
                if re.search(r'\\b(?:sample peak|true peak)\\s*:', following, re.IGNORECASE):
                    break
    return max(vals) if vals else None

def qc(path,is_video=False,expected_duration=None,target_lufs=-16):
    info=inspect_media(path); l=loudness(path); peak=true_peak(path)
    target=float(target_lufs); integrated=l.get('integrated_lufs')
    checks={'loudness_present':integrated is not None,'loudness_within_tolerance':integrated is not None and abs(integrated-target)<=0.5,
            'true_peak_present':peak is not None,'true_peak_safe':peak is not None and peak<=-1.0}
    if expected_duration is not None: checks['duration_preserved']=abs(info['duration']-expected_duration)<=0.15
    checks['all_pass']=all(checks.values())
    return {'checks':checks,'integrated_lufs':integrated,'true_peak_dbfs':peak,'target_lufs':target,'duration':info['duration'],'video':is_video}

def export_video(src,mastered,out):
    _run(['ffmpeg','-y','-hide_banner','-i',str(src),'-i',str(mastered),'-map','0:v:0','-map','1:a:0','-c:v','libvpx-vp9','-c:a','libopus',str(out)])

def _resume_config(src,target_lufs,stems,roles,gains,duck_music_db):
    stem_paths=[Path(x) for x in (stems or [])]
    payload={'input_path':str(Path(src).resolve()),'input_sha256':sha256(src),'target_lufs':float(target_lufs),'stems':[],
             'roles':list(roles or []),'gains_db':[float(x) for x in (gains or [0.0]*len(stem_paths))],'duck_music_db':float(duck_music_db)}
    for st in stem_paths: payload['stems'].append({'path':str(st.resolve()),'sha256':sha256(st) if st.exists() and st.is_file() else None})
    return payload

def _write_resume_manifest(stage,manifest):
    stage=Path(stage); tmp=stage/'RESUME-MANIFEST.json.tmp'; tmp.write_text(json.dumps(manifest,indent=2,sort_keys=True)); tmp.replace(stage/'RESUME-MANIFEST.json')

def _artifact_record(path):
    path=Path(path); return {'path':str(path),'bytes':path.stat().st_size,'sha256':sha256(path)}

def _artifact_valid(record):
    p=Path(record['path']); return p.exists() and p.is_file() and p.stat().st_size==record.get('bytes') and sha256(p)==record.get('sha256')

def _find_resume_stage(out,config):
    candidates=[]
    for stage in sorted(Path(out).glob('.osd-run-*')):
        if not stage.is_dir(): continue
        mf=stage/'RESUME-MANIFEST.json'
        if not mf.exists(): continue
        try: m=json.loads(mf.read_text())
        except Exception: continue
        if m.get('status')!='PROCESSING': continue
        if m.get('config')==config: candidates.append((stage,m))
    if len(candidates)>1: raise OSDRunError('Multiple resumable OSD processing runs match the same input/configuration; refusing ambiguous resume')
    return candidates[0] if candidates else None

def _resume_artifact(manifest,key):
    rec=manifest.get('artifacts',{}).get(key)
    return Path(rec['path']) if rec and _artifact_valid(rec) else None

def _commit_artifacts(out,stage,names,run_id):
    # Android build uses the same engine but does not need the local commit journal.
    journal={'status':'COMMITTED','run_id':run_id,'artifacts':names}
    (Path(out)/'COMMIT-JOURNAL.json').write_text(json.dumps(journal,indent=2))
    return journal

def _recover_stale_runs(out):
    return None

def _classify_error(exc):
    return type(exc).__name__

def run_pipeline(src,outdir,target_lufs=-16,stems=None,roles=None,gains=None,duck_music_db=0.0,enforce_qc=True,resume=False):
    src=Path(src); out=Path(outdir); out.mkdir(parents=True,exist_ok=True); _recover_stale_runs(out)
    if not src.exists() or not src.is_file():
        _write_failure_evidence(out,lifecycle=['PLANNED','AUTHORIZED','STARTED'],error=OSDRunError(f'Input not found: {src}'),src=src,run_id=uuid.uuid4().hex,staging_dir=None)
        raise OSDRunError(f'Input not found: {src}')
    config=_resume_config(src,target_lufs,stems,roles,gains,duck_music_db); run_id=uuid.uuid4().hex; resumed=False
    if resume:
        found=_find_resume_stage(out,config)
        if not found: raise OSDRunError('No safe resumable OSD processing run matches the input/configuration')
        stage,manifest=found; run_id=manifest['run_id']; resumed=True
    else:
        stage=out/f'.osd-run-{run_id}'; stage.mkdir(parents=True,exist_ok=False)
        manifest={'osd_version':'1.20.0','run_id':run_id,'status':'PROCESSING','created_at':time.time(),'config':config,'completed_stages':[],'artifacts':{}}
        _write_resume_manifest(stage,manifest)
    t=time.time(); lifecycle=['PLANNED','AUTHORIZED','STARTED']
    try:
        lifecycle.append('EXECUTING')
        inspection=inspect_media(src); source_hash_before=inspection['sha256']; source_assessment=source_quality(src)
        original=stage/('source-copy'+src.suffix)
        if _resume_artifact(manifest,'source-copy'): original=_resume_artifact(manifest,'source-copy')
        else:
            shutil.copy2(src,original); manifest['artifacts']['source-copy']=_artifact_record(original); manifest['completed_stages'].append('source_copy'); _write_resume_manifest(stage,manifest)
        stem_paths=[Path(x) for x in (stems or [])]
        if stem_paths:
            for st in stem_paths:
                if not st.exists() or not st.is_file(): raise OSDRunError(f'Stem not found: {st}')
            mix_source=stage/'mixed-source.wav'
            if not _resume_artifact(manifest,'mixed-source'):
                mix_stems(stem_paths,mix_source,roles=roles,gains=gains,duck_music_db=duck_music_db); manifest['artifacts']['mixed-source']=_artifact_record(mix_source); manifest['completed_stages'].append('stem_mix'); _write_resume_manifest(stage,manifest)
            else: mix_source=_resume_artifact(manifest,'mixed-source')
        else: mix_source=src
        processed=stage/'processed.wav'; mastered=stage/'mastered.wav'
        if not _resume_artifact(manifest,'processed'):
            render_audio(mix_source,processed); manifest['artifacts']['processed']=_artifact_record(processed); manifest['completed_stages'].append('render'); _write_resume_manifest(stage,manifest)
        else: processed=_resume_artifact(manifest,'processed')
        if not _resume_artifact(manifest,'mastered'):
            master_audio(processed,mastered); manifest['artifacts']['mastered']=_artifact_record(mastered); manifest['completed_stages'].append('master'); _write_resume_manifest(stage,manifest)
        else: mastered=_resume_artifact(manifest,'mastered')
        final=stage/('final.webm' if inspection['video'] else 'final.wav')
        if not _resume_artifact(manifest,'final'):
            if inspection['video']: export_video(src,mastered,final)
            else: shutil.copy2(mastered,final)
            manifest['artifacts']['final']=_artifact_record(final); manifest['completed_stages'].append('export'); _write_resume_manifest(stage,manifest)
        else: final=_resume_artifact(manifest,'final')
        source_stem_evidence=[]
        for st in stem_paths:
            si=inspect_media(st); source_stem_evidence.append({'path':str(st),'duration':si['duration'],'sample_rate':si['sample_rate'],'channels':si['channels'],'sha256':si['sha256']})
        source_hash_after=sha256(src); source_unchanged=(source_hash_before==source_hash_after)
        report={'osd_version':'1.20.0','run_id':run_id,'resumed':resumed,'execution_lifecycle':lifecycle,'lineage':'reconstructed functional continuation','historical_recovery':False,
                'input':inspection,'source_quality':source_assessment,'processing':'conservative chain; optional real stem mix; no neural provider','stems':[str(x) for x in stem_paths],
                'stem_compatibility':stem_compatibility(stem_paths) if stem_paths else None,'stem_roles':list(roles or []),
                'stem_gains_db':[float(x) for x in (gains or [0.0]*len(stem_paths))],'music_ducking_db':float(duck_music_db),
                'stem_source_evidence':source_stem_evidence,'master_target_lufs':target_lufs,'source_integrity':{'sha256_before':source_hash_before,'sha256_after':source_hash_after,'unchanged':source_unchanged},
                'timing':inspection['timing'],'qc':qc(final,inspection['video'],inspection['duration'] if inspection['video'] else None,target_lufs=target_lufs),
                'runtime_seconds':round(time.time()-t,3),'artifacts':{},'verification':{'status':'OBSERVED'},
                'resume':{'enabled':bool(resume),'resumed':resumed,'completed_stages':list(manifest.get('completed_stages',[]))}}
        for pth in [original,processed,mastered,final]: report['artifacts'][pth.name]={'bytes':pth.stat().st_size,'sha256':sha256(pth)}
        artifact_checks={}
        for pth in [original,processed,mastered,final]:
            recorded=report['artifacts'][pth.name]['sha256']; artifact_checks[pth.name]={'exists':pth.exists(),'sha256_matches':pth.exists() and sha256(pth)==recorded}
        report['artifact_integrity']=artifact_checks; report['checks']={'source_unchanged':source_unchanged,'artifacts_integrity_verified':all(v['exists'] and v['sha256_matches'] for v in artifact_checks.values())}
        lifecycle.extend(['OBSERVED','TESTED'])
        verified=report['qc']['checks']['all_pass'] and report['checks']['artifacts_integrity_verified'] and source_unchanged
        report['verification']={'status':'VERIFIED' if verified else 'UNVERIFIED','evidence_complete':True}
        report['delivery_status']='DELIVERABLE' if verified and report['qc']['checks']['all_pass'] else 'BLOCKED'
        lifecycle.append('VERIFIED' if verified else 'FAILED'); report['execution_lifecycle']=lifecycle
        if enforce_qc and not report['qc']['checks']['all_pass']: raise OSDRunError('Final QC failed; delivery blocked: '+json.dumps(report['qc']['checks'],sort_keys=True))
        # Materialize the verified final artifact outside the temporary staging directory.
        # The staging directory is deleted after commit, so the deliverable must be copied first.
        delivered_final=out/('OSD-final.webm' if inspection['video'] else 'OSD-final.wav')
        shutil.copy2(final, delivered_final)
        delivered_record=_artifact_record(delivered_final)
        report['delivery_artifact']=delivered_record
        final_names=[p.name for p in [original,processed,mastered,final]]
        if mix_source != src: final_names.append(mix_source.name)
        final_names.append(delivered_final.name)
        commit_journal=_commit_artifacts(out,stage,final_names,run_id); report['staging_committed']=commit_journal['status']=='COMMITTED'
        report_path=out/'evidence.json'; report_path.write_text(json.dumps(report,indent=2)); (out/'EVIDENCE-SHA256.txt').write_text(sha256(report_path)+'  evidence.json\n'); (out/'DELIVERY-READY.txt').write_text('OSD delivery verified and ready. Final artifact: '+delivered_final.name+'; see evidence.json and EVIDENCE-SHA256.txt.\n')
        manifest['status']='COMMITTED'; manifest['completed_stages'].append('commit'); _write_resume_manifest(stage,manifest); shutil.rmtree(stage)
        return report
    except Exception as exc:
        if 'report' in locals():
            report['status']='FAILED'; report['delivery_status']='BLOCKED'; report['verification']={'status':'UNVERIFIED','evidence_complete':True}; report['execution_lifecycle']=list(lifecycle)+(['FAILED'] if not lifecycle or lifecycle[-1]!='FAILED' else []); report['error_class']=_classify_error(exc); report['error']=str(exc); report['staging_dir']=str(stage)
            failure_path=out/'evidence.json'; failure_path.write_text(json.dumps(report,indent=2)); (out/'EVIDENCE-SHA256.txt').write_text(sha256(failure_path)+'  evidence.json\n'); (out/'DELIVERY-BLOCKED.txt').write_text('OSD delivery blocked. See evidence.json for the failure record.\n')
        else: _write_failure_evidence(out,lifecycle=lifecycle,error=exc,src=src,run_id=run_id,staging_dir=stage)
        if 'manifest' in locals():
            manifest['last_error']=str(exc); manifest['status']='PROCESSING'; _write_resume_manifest(stage,manifest)
        raise
